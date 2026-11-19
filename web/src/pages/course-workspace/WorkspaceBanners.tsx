import { Button, IconButton, Note } from "../../design-system/kit";

export function ErrorBanner({ error, onDismiss }: { error: string; onDismiss(): void }) {
  return (
    <Note role="alert" tone="warn" className="cw-banner">
      <span>{error}</span>
      <IconButton label="Dismiss" glyph="x" onClick={onDismiss} />
    </Note>
  );
}

export function TeacherAccessBanner({ onRespond }: { onRespond(approve: boolean): void }) {
  return (
    <Note tone="warn" className="cw-banner">
      <strong>Your teacher requested full access to current and future course work.</strong>
      <Button onClick={() => onRespond(false)}>Keep private</Button>
      <Button variant="primary" onClick={() => onRespond(true)}>Approve once</Button>
    </Note>
  );
}
