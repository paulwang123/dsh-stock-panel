import backend from './market.cjs'
const { registerRoutes } = backend
export const name = 'stock-panel'
export const inject = ['connection']
export function apply(ctx) {
  const dispose = registerRoutes(ctx.connection)
  ctx.effect(() => dispose, 'stock-panel.routes')
}
