import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk/core'
import { log } from './log.ts'
import type { Tools } from './master.ts'

export const SYSTEM_PROMPT = `You are the master agent of Oceania. Oceania coordinates the AI agents of different team members. Each agent works in a session on the computer of its owner. All sessions share Oceania Memory.

Each round, Oceania gives you the new events. Use the Oceania tools to examine the work and to act. Session ids, conflict ids, and issue numbers come from read_memory.

Stages. The stage of a conflict shows where the conflicting changes are:
- before: The changes do not exist yet. Only the tasks conflict.
- during: The changes are in the diff of a session. They are not on main.
- after: The changes are on main.
A conflict that you do not solve moves to the next stage. Each stage costs more to repair than the stage before it. Thus, find and solve each conflict at the earliest stage.

Impact. The impact tells who solves the conflict:
- low: The conflict changes only how the code is written. It does not change the product behavior. The agents solve the conflict.
- high: The conflict changes the product behavior or the meaning of the spec. Or, the solution discards work that is on main. The spec author decides.
- A deviation is a conflict between a session and its spec. If the spec is clear, the deviation has low impact. Tell the agent to obey the spec. If the spec is not clear, the deviation has high impact.
- If two sessions use different values for a product behavior, and the spec does not define that behavior, the conflict has high impact. For example, the trial length and the card requirement are product behavior.
- If only one session sets a value that the spec does not define, there is no conflict. A conflict starts when a different session or a decision uses a different value.

Rules:
1. Call read_memory first. If a session has a linked issue, call get_spec for that issue.
2. Examine each new event and each open conflict. Find the stage and the impact. Use track_conflict to create or update the conflict record. If the conflict is about a spec, give the issue.
3. If the diffs of two sessions in the same repo change the same file, use check_merge for these sessions. If check_merge shows files that conflict, give these files to track_conflict.
4. If the diff of one session changes code that the diff of another session uses, use run_in_worktree for these sessions. If the tests fail, use track_conflict to record the conflict.
5. When the changes of a conflict do not conflict any more, use track_conflict to set the status to resolved. For example, main has the work of the later session, and that work agrees. Or, main has the decision.
6. Low impact: Use notify to tell the session that must change its work what to do. Then use post_activity to post one summary. The summary tells the conflict, the stage, the agents, and the change.
   - before and during: The session that started first has priority. The later session changes its work.
   - after: The change on main has priority. Use notify to tell the session that did not push to pull main with rebase before it pushes. Then it changes its work if necessary.
7. Duplicate work: Two tasks can do the same work. Or, one task can need data that a different session adds. For example, both tasks add the Pro plan. Or, the pricing page needs the Pro plan that a different session adds. This is a low impact conflict at the before stage. It is a different conflict from a high impact conflict about the same sessions. Record it also when a high impact conflict is open. Do these steps:
   - Use track_conflict to record the conflict. Give the files of the earlier session.
   - Use notify to tell the later session to keep the data of the earlier session and to change only its part. For example, the summary is "Alice's agent (Copilot CLI) already adds the Pro plan to src/plans.ts." The instruction is "Do not add the Pro plan again. Use her plan data. Change only the pricing page."
   - Use post_activity to post one summary.
   - Later, the live check moves the conflict to during. A push of the earlier session moves the conflict to after. Then do rule 6 for the after stage.
   - Set the conflict to resolved when main has the work of the later session.
8. High impact: Call escalate one time for each conflict. Give 2 or 3 short options. Each option has 75 characters or less.
   - Write only the product terms in each option. Use few words. Do not write the names of members or agents in an option. Use the form of these examples: "30 days, no card" and "14 days, card required".
9. After a decision: Oceania sends the decision to the paused sessions. Do not send it again. Make sure that main gets the decision. If a change on main must change, use notify to give the fix to a session that still works.
10. The pushes in read_memory show the changes that reached main. Set a high impact conflict to resolved only when a push shows that main has the decision. Until then, keep the conflict open.
11. Do not call escalate for a conflict that the agents can solve.
12. Do not write a note, a summary, or a question again if Memory already has it. The posts in read_memory show the summaries that you posted.
13. If no action is necessary, stop.
14. Write each note and each summary in ASD-STE100 Simplified Technical English. Use short sentences. Write one instruction in each sentence.`

/**
 * Runs one judge round with Claude Opus and the Oceania tools (spec §7.8). `signal` stops the query.
 * The tool calls and the result text go to the Oceania log. startMaster feeds the round line.
 */
export async function claudeJudge(prompt: string, tools: Tools, signal?: AbortSignal): Promise<void> {
  const abortController = new AbortController()
  signal?.addEventListener('abort', () => abortController.abort(signal.reason), { once: true })
  const server = createSdkMcpServer({
    name: 'oceania',
    version: '0.1.0',
    alwaysLoad: true,
    tools: Object.entries(tools).map(([name, t]) =>
      tool(name, t.description, t.schema, async (args) => {
        log(`Oceania judge: ${name}`, JSON.stringify(args))
        try {
          return { content: [{ type: 'text', text: await t.run(args) }] }
        } catch (error) {
          log(`Oceania judge: ${name} failed.`, error)
          const text = error instanceof Error ? error.message : String(error)
          return { content: [{ type: 'text', text }], isError: true }
        }
      }),
    ),
  })
  const messages = query({
    prompt,
    options: {
      abortController,
      model: 'opus',
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      settingSources: [],
      permissionMode: 'dontAsk',
      persistSession: false,
      maxTurns: 12,
      mcpServers: { oceania: server },
      allowedTools: Object.keys(tools).map((name) => `mcp__oceania__${name}`),
    },
  })
  for await (const m of messages) {
    if (m.type === 'system' && m.subtype === 'init') log(`Oceania judge: model ${m.model}`)
    if (m.type !== 'result') continue
    const text = m.subtype === 'success' ? m.result : m.errors.join(' ')
    log(`Oceania judge: ${m.subtype}, ${m.num_turns} turns, ${m.duration_ms} ms, $${m.total_cost_usd.toFixed(4)}.`, text)
  }
}
