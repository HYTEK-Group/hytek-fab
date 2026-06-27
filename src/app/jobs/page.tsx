import { redirect } from 'next/navigation'

// There is no standalone /jobs index — the job board lives at /shop and
// individual jobs at /jobs/[id]. Send a bare /jobs visit to the board.
export default function JobsIndexRedirect() {
  redirect('/shop')
}
