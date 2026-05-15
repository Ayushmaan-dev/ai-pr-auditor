// This file is intentionally bad for testing the AI PR Auditor

// 🔴 SECURITY: Hardcoded API key
const API_KEY = 'sk-prod-1234567890abcdef'
const DB_PASSWORD = 'admin123'

// 🟠 PERFORMANCE: O(n²) nested loop
function findDuplicates(arr: number[]): number[] {
  const duplicates = []
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      if (i !== j && arr[i] === arr[j]) {
        duplicates.push(arr[i])
      }
    }
  }
  return duplicates
}

// 📝 DOCUMENTATION: No JSDoc, unclear variable names
function calc(x: number, y: number, z: number) {
  const t = x * y
  const r = t / z
  const f = r + x
  return f
}

// 🏗️ DESIGN: Function doing too many things (SRP violation)
async function doEverything(userId: string) {
  // validate user
  if (!userId) throw new Error('no user')

  // fetch from db
  const user = await fetch(`http://api.example.com/users/${userId}`)

  // send email
  await fetch('http://mail.example.com/send', {
    method: 'POST',
    body: JSON.stringify({ to: userId, message: 'hello' })
  })

  // log analytics
  await fetch('http://analytics.example.com/track', {
    method: 'POST',
    body: JSON.stringify({ event: 'user_fetched', userId })
  })

  return user
}

export { findDuplicates, calc, doEverything }