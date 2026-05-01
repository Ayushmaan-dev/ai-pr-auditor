import * as core from '@actions/core'
import * as github from '@actions/github'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'

// --- Zod Schema ---
const ReviewSchema = z.object({
  summary: z.string(),
  analyzedFiles: z.array(z.string()),
  issues: z.array(
    z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      category: z.enum(['security', 'performance', 'documentation', 'design']),
      file: z.string(),
      description: z.string(),
      suggestion: z.string()
    })
  ),
  approved: z.boolean()
})

type Review = z.infer<typeof ReviewSchema>

// --- Filter noise from the diff ---
function filterDiff(diff: string): string {
  const ignoredExtensions = [
    '.png',
    '.jpg',
    '.jpeg',
    '.svg',
    '.gif',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot'
  ]
  const ignoredFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
  const ignoredDirs = ['dist/', 'build/', '.next/', 'node_modules/']

  const files = diff.split('diff --git')
  const filtered = files.filter((chunk) => {
    if (!chunk.trim()) return false
    const firstLine = chunk.split('\n')[0]
    if (ignoredFiles.some((f) => firstLine.includes(f))) return false
    if (ignoredDirs.some((d) => firstLine.includes(d))) return false
    if (ignoredExtensions.some((ext) => firstLine.includes(ext))) return false
    return true
  })

  // Fix: rejoin with the prefix to keep diff format valid
  return filtered.join('\ndiff --git')
}

// --- Build the prompt ---
function buildPrompt(diff: string): string {
  return `You are a Staff Engineer conducting a Pull Request review. Analyze the following Git diff and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

The JSON must follow this exact structure:
{
  "summary": "Brief overall summary of the PR changes",
  "analyzedFiles": ["list", "of", "files", "you", "analyzed"],
  "issues": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "security" | "performance" | "documentation" | "design",
      "file": "filename where issue exists",
      "description": "What the issue is",
      "suggestion": "How to fix it"
    }
  ],
  "approved": true | false
}

Focus on:
1. SECURITY: Hardcoded secrets, API keys, tokens, SQL injection, XSS vectors
2. PERFORMANCE: O(n²) loops, missing indexes, blocking operations, memory leaks
3. DOCUMENTATION: Missing JSDoc on exported functions, unclear variable names
4. DESIGN: Single Responsibility violations, deeply nested logic

Git Diff:
${diff}`
}

// --- Format review as Markdown comment ---
function formatComment(review: Review): string {
  const statusEmoji = review.approved ? '✅' : '❌'
  const statusText = review.approved ? 'APPROVED' : 'CHANGES REQUESTED'

  const severityEmoji: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵'
  }

  const categoryEmoji: Record<string, string> = {
    security: '🔒',
    performance: '⚡',
    documentation: '📝',
    design: '🏗️'
  }

  let comment = `## ${statusEmoji} AI PR Auditor — ${statusText}\n\n`
  comment += `### Summary\n${review.summary}\n\n`

  // Always show analyzed files so devs know what the bot actually saw
  comment += `### Files Analyzed\n`
  comment += review.analyzedFiles.map((f) => `- \`${f}\``).join('\n')
  comment += '\n\n'

  if (review.issues.length === 0) {
    comment += `> ✅ No issues found. Clean diff.\n`
  } else {
    comment += `### Issues Found (${review.issues.length})\n\n`
    for (const issue of review.issues) {
      comment += `---\n`
      comment += `**${severityEmoji[issue.severity]} ${issue.severity.toUpperCase()}** ${categoryEmoji[issue.category]} \`${issue.category}\`\n\n`
      comment += `**File:** \`${issue.file}\`\n\n`
      comment += `**Issue:** ${issue.description}\n\n`
      comment += `**Suggestion:** ${issue.suggestion}\n\n`
    }
  }

  comment += `---\n*Powered by Google Gemini · AI PR Auditor by [@Ayushmaan-dev](https://github.com/Ayushmaan-dev)*`
  return comment
}

// --- Idempotent comment: update if exists, create if not ---
async function upsertComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const BOT_SIGNATURE = 'Powered by Google Gemini · AI PR Auditor'

  // Paginate to fetch ALL comments, not just first 30
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber
  })

  const existing = comments.find((c) => c.body?.includes(BOT_SIGNATURE))

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body
    })
    core.info('Updated existing review comment.')
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body
    })
    core.info('Posted new review comment.')
  }
}

// --- Main ---
export async function run(): Promise<void> {
  try {
    const geminiApiKey = core.getInput('gemini-api-key', { required: true })
    const githubToken = core.getInput('github-token', { required: true })

    const context = github.context
    const octokit = github.getOctokit(githubToken)

    if (!context.payload.pull_request) {
      core.setFailed('This action only runs on pull_request events.')
      return
    }

    const prNumber = context.payload.pull_request.number
    const owner = context.repo.owner
    const repo = context.repo.repo

    core.info(`Fetching diff for PR #${prNumber}...`)

    const { data: diffData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' }
    })

    const rawDiff = diffData as unknown as string
    const filteredDiff = filterDiff(rawDiff)

    if (!filteredDiff.trim()) {
      core.info('No meaningful changes found after filtering. Skipping review.')
      return
    }

    // Fix: hard truncation to prevent context window overflow
    const safeDiff =
      filteredDiff.length > 60000
        ? filteredDiff.substring(0, 60000) + '\n\n...[DIFF TRUNCATED FOR SIZE]'
        : filteredDiff

    core.info('Sending diff to Gemini...')

    // Fix: enforce JSON response at API level, not just prompt level
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })

    const prompt = buildPrompt(safeDiff)
    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    // Fix: strip markdown fences if Gemini wraps response anyway
    const cleanJson = responseText
      .replace(/```json/gi, '')
      .replace(/```/gi, '')
      .trim()

    // Fix: differentiate Zod errors from JSON parse errors
    let review: Review
    try {
      const parsed = JSON.parse(cleanJson)
      review = ReviewSchema.parse(parsed)
    } catch (error) {
      if (error instanceof z.ZodError) {
        core.setFailed(
          `Schema validation failed: ${JSON.stringify(error.issues)}`
        )
      } else {
        core.setFailed(`JSON parse failed. Raw output: ${cleanJson}`)
      }
      return
    }

    const comment = formatComment(review)
    await upsertComment(octokit, owner, repo, prNumber, comment)

    core.info('Review posted successfully.')

    if (!review.approved) {
      core.setFailed(
        'AI Auditor requested changes. See PR comment for details.'
      )
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
