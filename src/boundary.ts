import { h } from './h'
import { LANE } from "./reconciler"

// TODO: The lazy function has nothing to do with the core. 
// It just throw a promise . We will move it out of the core in the future.
export function lazy(loader) {
  let p
  let comp
  let err
  return function Lazy(props) {
    if (!p) {
      p = loader()
      p.then(
        exports => (comp = exports.default || exports),
        e => (err = e)
      )
    }
    if (err) throw err
    if (!comp) throw p
    return h(comp, props)
  }
}

export function Suspense(props) {
  (Suspense as any).lane = LANE.Suspense
  return props.children
}

export function ErrorBoundary(props) {
  (ErrorBoundary as any).lane = LANE.Error
  return props.children
}

export function Fragment(props) {
  return props.children
}