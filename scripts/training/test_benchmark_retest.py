import unittest
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import benchmark_retest as r

class RetestTests(unittest.TestCase):
    def test_exclusions_keep_gemma(self):
        arms=[{'provider':p,'model':m} for p,m in [('gemini','gemini'),('anthropic','claude'),('openai-chat','gemma-4'),('tinker-native','Qwen/Qwen3.8')]]
        self.assertEqual([a['model'] for a in r.eligible(arms)],['gemma-4','Qwen/Qwen3.8'])
    def test_tool_result_is_followed_and_cost_covers_both_calls(self):
        seen=[]
        def dispatch(request,index):
            seen.append(request)
            response={'content':'done','tool_calls':[]} if index else {'content':'','tool_calls':[{'id':'a','function':{'name':'feedback','arguments':'{}'}}]}
            return {'response':response,'usage':{'prompt_tokens':10,'completion_tokens':2},'cost_usd':.2,'wall_seconds':1}
        def tool(script,value):
            return {'execution':[{'ok':True}],'tool_messages':[{'role':'tool','tool_call_id':'a','name':'feedback','content':'saved'}]}
        row=r.episode({'id':'a','category':'memory','messages':[{'role':'user','content':'help'}],'max_tokens':100},{'system_prompt':'exact','tools':[]},dispatch,tool)
        self.assertEqual(row['stop'],'final_response'); self.assertEqual(row['cost_usd'],.4)
        self.assertEqual(row['output_tokens'],4)
        self.assertEqual(seen[1]['payload']['messages'][-1]['content'],'saved')
        self.assertEqual(seen[1]['payload']['messages'][0]['content'],'exact')
    def test_unknown_cost_not_zero(self):
        self.assertIsNone(r.totals([{'wall_seconds':1,'error':{}}])['cost_usd'])
    def test_bounded_loop(self):
        def dispatch(request,index):
            return {'response':{'content':'','tool_calls':[{'id':'a'}]},'wall_seconds':1}
        def tool(script,value): return {'execution':[],'tool_messages':[]}
        row=r.episode({'id':'a','category':'memory','messages':[],'max_tokens':100},{'system_prompt':'exact','tools':[]},dispatch,tool)
        self.assertEqual(len(row['calls']),3); self.assertEqual(row['stop'],'turn_limit')

    def test_provider_error_after_tool_response_is_unavailable_and_preserves_known_cost(self):
        def dispatch(request,index):
            if index: return {'error':{'kind':'rate_limit'},'wall_seconds':1}
            return {'response':{'content':'','tool_calls':[{'id':'a'}]},'cost_usd':.12,'wall_seconds':1}
        row=r.episode({'id':'a','category':'memory','messages':[],'max_tokens':100},{'system_prompt':'exact','tools':[]},dispatch,
                      lambda *_: {'execution':[],'tool_messages':[]})
        self.assertEqual(row['stop'],'provider_error')
        self.assertEqual(row['measurement_status'],'unavailable')
        self.assertEqual(len(row['turns']),1)
        self.assertEqual(len(row['calls']),2)
        self.assertEqual(row['known_cost_usd'],.12)
        self.assertIsNone(row['cost_usd'])

    def test_tool_harness_failure_keeps_the_actual_response_and_usage(self):
        def broken(*_): raise RuntimeError('isolated test failure')
        row=r.episode({'id':'a','category':'memory','messages':[],'max_tokens':100},{'system_prompt':'exact','tools':[]},
                      lambda *_: {'response':{'content':'','tool_calls':[{'id':'a'}]},'cost_usd':.12,'wall_seconds':1},broken)
        self.assertEqual(row['stop'],'harness_error')
        self.assertEqual(row['measurement_status'],'unavailable')
        self.assertEqual(row['known_cost_usd'],.12)
        self.assertEqual(len(row['turns']),1)

    def test_checker_failure_does_not_abort_later_cases(self):
        class StubDispatch:
            def __init__(self,arm): pass
            def __call__(self,*_): return {'response':{'content':'An actual reply.','tool_calls':[]},'cost_usd':.1,'wall_seconds':1}
        cases=[{'id':str(i),'category':'test','messages':[],'max_tokens':100} for i in range(2)]
        arm={'provider':'openai-chat','model':'test','label':'test'}
        with tempfile.TemporaryDirectory() as directory, patch.object(r,'HttpDispatch',StubDispatch), patch.object(r,'command_json',side_effect=[ValueError('checker failed'),{'contract_passed':True}]):
            result=r.run_arm(arm,cases,{'system_prompt':'exact','tools':[]},Path(directory))
        self.assertEqual(result['status'],'complete')
        self.assertEqual(len(result['rows']),2)
        self.assertIsNone(result['rows'][0]['checks'])
        self.assertEqual(result['rows'][0]['measurement_status'],'unavailable')
        self.assertTrue(result['rows'][1]['checks']['contract_passed'])

    def test_frozen_closure_runtime_and_runner_sources_are_required(self):
        sources={f'scripts/training/{name}':r.b.digest((Path(r.__file__).parent/name).read_bytes()) for name in r.RUNNER_SOURCES}
        inventory={'contract_sources':{'checker.ts':'frozen-hash'},'contract_runtime':{'name':'bun','version':'test','revision':'test'}}
        manifest={**inventory,'files':{},'runner_sources':sources}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory); (path/'manifest.json').write_text(json.dumps(manifest))
            with patch.object(r.b,'load_suite',return_value={'cases':[]}), patch.object(r.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(inventory))):
                self.assertEqual(r.verify_frozen_suite(path),{'cases':[]})
                for field in ('contract_sources','contract_runtime','runner_sources'):
                    changed={**manifest,field:{}}; (path/'manifest.json').write_text(json.dumps(changed))
                    with self.assertRaises(ValueError): r.verify_frozen_suite(path)

if __name__=='__main__': unittest.main()
