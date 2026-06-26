// GET /api/fab/crew — today's crew: workers with tasks across all active fab jobs

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireFabUser } from '@/lib/get-fab-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireFabUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)
  const admin = getSupabaseAdmin()

  // All in-progress fab jobs
  const { data: activeJobs } = await admin
    .from('fab_jobs')
    .select('id, quote_number, name')
    .eq('status', 'in_progress')

  const jobIds = (activeJobs ?? []).map((j: { id: string }) => j.id)
  if (jobIds.length === 0) return NextResponse.json({ crew: [] })

  // Tasks assigned to workers across active jobs
  const { data: tasks } = await admin
    .from('fab_tasks')
    .select('id, fab_job_id, description, assigned_to, status')
    .in('fab_job_id', jobIds)
    .neq('status', 'done')
    .not('assigned_to', 'is', null)

  // Time logged today per worker
  const { data: timeToday } = await admin
    .from('fab_time_entries')
    .select('fab_job_id, worker_name, hours')
    .in('fab_job_id', jobIds)
    .eq('work_date', today)

  // Build crew map: worker → { tasks, hours_today, current_job }
  const crewMap = new Map<string, {
    worker_name: string
    tasks: Array<{ description: string; status: string; job_name: string; quote_number: string }>
    hours_today: number
    current_job: string | null
    current_quote: string | null
  }>()

  const jobById = new Map((activeJobs ?? []).map((j: { id: string; name: string; quote_number: string }) => [j.id, j]))

  for (const task of tasks ?? []) {
    const name = task.assigned_to as string
    const job = jobById.get(task.fab_job_id)
    if (!crewMap.has(name)) {
      crewMap.set(name, { worker_name: name, tasks: [], hours_today: 0, current_job: null, current_quote: null })
    }
    crewMap.get(name)!.tasks.push({
      description: task.description,
      status: task.status,
      job_name: job?.name ?? '',
      quote_number: job?.quote_number ?? '',
    })
  }

  for (const entry of timeToday ?? []) {
    const name = entry.worker_name as string
    if (!crewMap.has(name)) {
      crewMap.set(name, { worker_name: name, tasks: [], hours_today: 0, current_job: null, current_quote: null })
    }
    crewMap.get(name)!.hours_today += entry.hours ?? 0
    const job = jobById.get(entry.fab_job_id)
    if (job) {
      crewMap.get(name)!.current_job = job.name
      crewMap.get(name)!.current_quote = job.quote_number
    }
  }

  const crew = Array.from(crewMap.values()).sort((a, b) =>
    a.worker_name.localeCompare(b.worker_name)
  )

  return NextResponse.json({ crew, date: today })
}
