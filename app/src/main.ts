import { mount } from 'svelte'
import App from './App.svelte'
import type { Agent } from './agent.js'
import { HttpApi, type Api } from './api.js'
import './app.css'

// With VITE_API=fake (npm run dev:fake) the demo entries in memory stand in for the server.
async function makeApi(): Promise<Api> {
  if (import.meta.env.VITE_API !== 'fake') return new HttpApi(import.meta.env.VITE_API ?? '/api')
  const [{ FakeApi }, { DEMO }] = await Promise.all([import('./fake.js'), import('./demo-seed.js')])
  return new FakeApi(Object.keys(DEMO).length > 0 ? DEMO : undefined)
}

// The assistant: the demo has a stand-in (it knows one sentence), otherwise the Worker asks the model.
async function makeAgent(): Promise<Agent> {
  if (import.meta.env.VITE_API !== 'fake') return new (await import('./worker-agent.js')).WorkerAgent(import.meta.env.VITE_API ?? '/api')
  return new (await import('./agent.js')).FakeAgent()
}

mount(App, { target: document.getElementById('app')!, props: { api: await makeApi(), agent: await makeAgent() } })
