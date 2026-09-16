import Database from 'better-sqlite3'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'

app.whenReady().then(() => {
  try {
    const p = path.join(os.tmpdir(), 'sf-sqlite-smoke.sqlite')
    const db = new Database(p)
    db.exec('CREATE TABLE IF NOT EXISTS t(x INTEGER)')
    const row = db.prepare('SELECT 1 AS n').get()
    console.log('[smoke] better-sqlite3 OK', row)
    db.close()
    app.exit(0)
  } catch (err) {
    console.error('[smoke] FAIL', err)
    app.exit(1)
  }
})
