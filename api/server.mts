import { analysisApp } from './_configured-app.mts'

const port = Number(process.env.HEPATOPLAN_API_PORT ?? 4191)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HEPATOPLAN_API_PORT.')
const server = analysisApp.listen(port, '127.0.0.1', () => console.info(`Analysis API at http://127.0.0.1:${port}`))
server.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
