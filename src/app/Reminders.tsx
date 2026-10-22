import { useApp, setLive, mutate, getState, activeCharacter } from "../state/store.ts";
import { useQuery } from "../state/store.ts";
import * as repo from "../db/repo.ts";
import { Icon } from "../ui/icons.tsx";
import { Btn } from "../ui/bits.tsx";

/** A quiet banner when a reminder's trigger matched live data. Never a popup. */
export function ReminderBanner() {
  const ids = useApp((s) => s.live.reminders);
  const ch = useApp(activeCharacter);
  const { data } = useQuery((d) => (ch ? repo.listEntries(d, ch.id, "reminder") : Promise.resolve([])), [ch?.id], [] as repo.Entry[]);
  const due = data.filter((e) => ids.includes(e.id) && !e.done);
  if (!due.length) return null;
  const dismiss = (id: string) => setLive({ reminders: getState().live.reminders.filter((x) => x !== id) });
  return (
    <div className="banner reminder-banner">
      <Icon name="clock" size={18} />
      <span>
        <strong>Reminder:</strong> {due[0].title}
        {due[0].place ? <span className="muted"> — {due[0].kind === "place" ? `you are near ${due[0].place}` : due[0].place}</span> : null}
        {due.length > 1 ? <span className="muted"> (+{due.length - 1} more)</span> : null}
      </span>
      <Btn small icon="check" onClick={() => void mutate((d) => repo.updateEntry(d, due[0].id, { done: true })).then(() => dismiss(due[0].id))}>
        Done
      </Btn>
      <Btn small kind="ghost" onClick={() => dismiss(due[0].id)}>
        Later
      </Btn>
    </div>
  );
}
