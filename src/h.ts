import { isStr, arrayfy } from "./reconcile"
import { FreElement } from "./type"

// for jsx2
export const h = (type, props: any, ...kids) => {
  props = props || {}
  const c = arrayfy(props.children || kids)
  kids = flat(c).filter((i) => i != null)
  if (kids.length) props.children = kids.length === 1 ? kids[0] : kids
  let key = props.key || null,
    ref = props.ref || null
  delete props.key
  delete props.ref
  return createVnode(type, props, key, ref)
}

const flat = (arr) =>
  [].concat(
    ...arr.map((v) =>
      isArr(v) ? [].concat(flat(v)) : isStr(v) ? createText(v) : v
    )
  )

export const createVnode = (type, props, key, ref) => ({
  type,
  props,
  key,
  ref,
})

export const createText = (vnode: any) =>
  ({ type: "", props: { nodeValue: vnode + "" } } as FreElement)

export function Fragment(props) {
  return props.children
}

export const isArr = Array.isArray

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
  return props.children
}
