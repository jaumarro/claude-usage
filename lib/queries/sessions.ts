import type { DatabaseSync } from 'node:sqlite';
import type { SessionBlock } from '@/lib/charts/sessionsInParallel';
import {
  ALL_TIME_ALL_SURFACES,
  BUCKET_EXPRESSION,
  bucketStart,
  nextBucketStart,
  perRequest,
  type Bucket,
  type QueryFilters,
} from '@/lib/queries/aggregate';

/** A worktree's own folder tells it apart from its siblings, and the rest of its path does not. */
function folderOf(project: string): string {
  return project.slice(project.lastIndexOf('/') + 1) || project;
}

/**
 * One row per session and bucket it sent a request in, ordered by when the session started. A
 * session's working directory moves when it changes folder, so it is filed under the project it
 * started in. A third of sessions also switch branch, often off `main` to the one the work is on,
 * so a session is named by the branch most of its requests were sent from. A detached `HEAD`
 * names nothing.
 */
function blocksSql(bucket: Bucket, filters: QueryFilters): string {
  return `${perRequest(filters)},
  firsts AS (
    SELECT session_id, COALESCE(project, 'unknown') AS project,
      ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts) AS n
    FROM per_request
    WHERE session_id IS NOT NULL
  ),
  branches AS (
    SELECT session_id, git_branch AS branch,
      ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY COUNT(*) DESC, MAX(ts) DESC) AS n
    FROM per_request
    WHERE session_id IS NOT NULL AND git_branch IS NOT NULL AND git_branch != 'HEAD'
    GROUP BY session_id, git_branch
  ),
  sessions AS (
    SELECT session_id, MIN(ts) AS started
    FROM per_request
    WHERE session_id IS NOT NULL
    GROUP BY session_id
  ),
  active AS (
    SELECT session_id, MIN(ts) AS first,
      SUM(input + output + cache_read + cache_create_5m + cache_create_1h) AS spent
    FROM per_request
    WHERE session_id IS NOT NULL
    GROUP BY ${BUCKET_EXPRESSION[bucket]}, session_id
  )
  SELECT active.first AS first, active.session_id AS session, firsts.project AS project,
    branches.branch AS branch, active.spent AS spent
  FROM active
  JOIN sessions ON sessions.session_id = active.session_id
  JOIN firsts ON firsts.session_id = active.session_id AND firsts.n = 1
  LEFT JOIN branches ON branches.session_id = active.session_id AND branches.n = 1
  ORDER BY sessions.started, active.session_id, active.first`;
}

export function sessionBlocks(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): SessionBlock[] {
  return db
    .prepare(blocksSql(bucket, filters))
    .all()
    .map((row) => {
      const from = bucketStart(Number(row.first), bucket);
      return {
        from,
        to: nextBucketStart(from, bucket),
        session: String(row.session),
        project: folderOf(String(row.project)),
        branch: row.branch === null ? null : String(row.branch),
        spent: Number(row.spent),
      };
    });
}
