import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'

vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('@google/generative-ai')

describe('main.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails if not triggered by a pull_request event', async () => {
    vi.spyOn(github, 'getOctokit').mockReturnValue({} as never)
    vi.stubGlobal('github', {
      context: { payload: {}, repo: { owner: 'test', repo: 'test' } }
    })

    const { run } = await import('../src/main.js')
    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'This action only runs on pull_request events.'
    )
  })
})
