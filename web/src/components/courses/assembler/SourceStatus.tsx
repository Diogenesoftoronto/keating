/** Loading note and load-failure alert for the saved-work sources. */
import { Loading, Note } from "../../../design-system/kit";
export function SourceStatus({
  loading,
  error,
}: {
  loading: boolean;
  error: string;
}) {
  return <>
    {loading && <Loading label="Looking through your saved work…" />}
    {error && <Note tone="warn" role="alert">Your saved sources could not be loaded: {error}. You can still create a blank course.</Note>}
  </>;
}
