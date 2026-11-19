import { Button, Loading, Note } from "../../../design-system/kit";

export function CreateFooter({
  creating,
  titleValid,
  hasSources,
  error,
  onCreate,
}: {
  creating: boolean;
  titleValid: boolean;
  hasSources: boolean;
  error: string;
  onCreate(): void;
}) {
  return <>
    <Button variant="primary" busy={creating} {...(!creating && {glyph: "plus" as const})} disabled={!titleValid} onClick={onCreate}>
      {creating ? <Loading size="inline" label="Creating…" /> : hasSources ? "Create assembled course" : "Create blank course"}
    </Button>
    {error && <Note role="alert">{error}</Note>}
  </>;
}
