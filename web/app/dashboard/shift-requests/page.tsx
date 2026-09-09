import { redirect } from 'next/navigation';

// Shift Requests moved into the Shifts page (Requests tab). Keep this route as a
// redirect so existing links and bookmarks still resolve.
export default function ShiftRequestsRedirect() {
  redirect('/dashboard/shifts');
}
