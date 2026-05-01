import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const files = [path.join(__dirname, '..', 'dist', 'index.js')]

files.forEach((file) => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8')
    const normalized = content.replace(/\r\n/g, '\n')
    fs.writeFileSync(file, normalized, 'utf8')
    console.log(`Normalized ${file} to LF`)
  }
})
