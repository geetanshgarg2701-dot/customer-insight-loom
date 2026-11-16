import { Suspense } from "react";
import { EntryView } from "./entry-view";

export default function EntryPage() {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <EntryView />
    </Suspense>
  );
}
