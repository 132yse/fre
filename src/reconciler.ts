import {
  IFiber,
  FreElement,
  FC,
  Attributes,
  HTMLElementEx,
  FreNode,
  IRef,
  IEffect,
} from "./type"
import { createElement, updateElement } from "./dom"
import { resetCursor } from "./hook"
import { scheduleWork, shouldYield, schedule } from "./scheduler"
import { isArr, createText, recycleNode } from "./h"

let currentFiber: IFiber
let finish = null
let deletes = []

export const enum LANE {
  UPDATE = 1 << 1,
  INSERT = 1 << 2,
  REMOVE = 1 << 3,
  SVG = 1 << 4,
  DIRTY = 1 << 5,
  Suspense = 1 << 6,
  Error = 1 << 7,
  Boundary = Suspense | Error,
}
export const render = (
  vnode: FreElement,
  node: Node,
  done?: () => void
): void => {
  const rootFiber = {
    node,
    props: { children: vnode },
    done,
  } as IFiber
  dispatchUpdate(rootFiber)
}

export const dispatchUpdate = (fiber?: IFiber) => {
  if (fiber && !(fiber.lane & LANE.DIRTY)) {
    fiber.lane = LANE.UPDATE | LANE.DIRTY
    fiber.sibling = null
    scheduleWork(reconcileWork as any, fiber)
  }
}

const reconcileWork = (WIP?: IFiber): boolean => {
  while (WIP && !shouldYield()) WIP = reconcile(WIP)
  if (WIP) return reconcileWork.bind(null, WIP)
  if (finish) commitWork(finish)
  return null
}

const reconcile = (WIP: IFiber): IFiber | undefined => {
  isFn(WIP.type) ? updateHook(WIP) : updateHost(WIP)
  if (WIP.child) return WIP.child
  while (WIP) {
    if (!finish && WIP.lane & LANE.DIRTY) {
      finish = WIP
      WIP.lane &= ~LANE.DIRTY
      return null
    }
    if (WIP.sibling) return WIP.sibling
    WIP = WIP.parent
  }
}

const updateHook = <P = Attributes>(WIP: IFiber): void => {
  currentFiber = WIP
  resetCursor()
  try {
    var children = (WIP.type as FC<P>)(WIP.props)
  } catch (e) {
    const then = typeof e?.then === "function",
      p = getBoundary(WIP, then),
      fb = simpleVnode(p.props.fallback, e)
    if (!p || !fb) throw e
    if (then) {
      if (!p.laziness) {
        p.laziness = []
        p.child = children = fb
      }
      p.laziness.push(e)
    } else {
      children = fb
    }
  }
  isStr(children) && (children = simpleVnode(children))

  if (!isFn(children.type)) {
    const vnode = (recycleNode(getParent(WIP)) as any)
    WIP.kids = arrayfy(vnode.props.children)
  }
  reconcileChildren(WIP, children)
}

const simpleVnode = (type: any, props?: any) =>
  isStr(type) ? createText(type as string) : isFn(type) ? type(props) : type

const getParent = (WIP: IFiber): HTMLElement | undefined => {
  while ((WIP = WIP.parent)) {
    if (!isFn(WIP.type)) return WIP.node
  }
}

const getBoundary = (WIP: IFiber, then): IFiber | undefined => {
  while ((WIP = WIP.parent)) {
    if ((WIP.type as any).lane & (then ? LANE.Suspense : LANE.Error)) {
      return WIP
    }
  }
}

const updateHost = (WIP: IFiber): void => {
  if (!WIP.node) {
    if (WIP.type === "svg") WIP.lane |= LANE.SVG
    WIP.node = createElement(WIP) as HTMLElementEx
    WIP.parentNode = getParent(WIP) as any
  }
  reconcileChildren(WIP, WIP.props.children)
}

const reconcileChildren = (WIP: any, children: FreNode): void => {
  let aCh = WIP.kids || [],
    bCh = (WIP.kids = arrayfy(children) as any),
    aHead = 0,
    bHead = 0,
    aTail = aCh.length - 1,
    bTail = bCh.length - 1,
    map = null,
    ch = Array(bCh.length)

  console.log(aCh,bCh)

  while (aHead <= aTail && bHead <= bTail) {
    let c = null
    if (aCh[aHead] == null) {
      aHead++
    } else if (aCh[aTail] == null) {
      aTail--
    } else if (same(aCh[aHead], bCh[bHead])) {
      c = bCh[bHead]
      clone(c, aCh[aHead])
      c.lane |= LANE.UPDATE
      ch[bHead] = c
      aHead++
      bHead++
    } else if (same(aCh[aTail], bCh[bTail])) {
      c = bCh[bTail]
      clone(c, aCh[aTail])
      c.lane |= LANE.UPDATE
      ch[bTail] = c
      aTail--
      bTail--
    } else {
      if (!map) {
        map = new Map()
        for (let i = aHead; i <= aTail; i++) {
          let k = getKey(aCh[i])
          k && map.set(k, i)
        }
      }
      const key = getKey(bCh[bHead])
      if (map.has(key)) {
        const oldKid = aCh[map.get(key)]
        c = bCh[bHead]
        clone(c, oldKid)
        c.lane = LANE.INSERT
        c.after = aCh[aHead]
        ch[bHead] = c
        aCh[map.get(key)] = null
      } else {
        c = bCh[bHead]
        c.lane = LANE.INSERT
        c.node = null
        c.after = aCh[aHead]
      }
      bHead++
    }
  }

  const after = ch[bTail + 1]

  while (bHead <= bTail) {
    let c = bCh[bHead]
    if (c) {
      c.lane = LANE.INSERT
      c.after = after
      c.node = null
    }
    bHead++
  }

  while (aHead <= aTail) {
    let c = aCh[aHead]
    if (c) {
      c.lane = LANE.REMOVE
      deletes.push(c)
    }
    aHead++
  }
  for (var i = 0, prev = null; i < bCh.length; i++) {
    const child = bCh[i]
    // console.log(child)
    child.parent = WIP
    if (i > 0) {
      prev.sibling = child
    } else {
      if (WIP.lane & LANE.SVG) child.lane |= LANE.SVG
      WIP.child = child
    }
    prev = child
  }
}

function clone(a, b) {
  a.oldProps = b.props
  a.node = b.node
  a.kids = b.kids
  a.hooks = b.hooks
  a.ref = b.ref
}

const getKey = (vdom) => (vdom == null ? vdom : vdom.key)
const getType = (vdom) => (isFn(vdom.type) ? vdom.type.name : vdom.type)

const commitWork = (fiber: IFiber): void => {
  fiber.parent ? commit(fiber) : commit(fiber.child)
  deletes.forEach(commit)
  fiber.done?.()
  deletes = []
  finish = null
}

function invokeHooks(fiber) {
  const { hooks, lane, laziness } = fiber
  if (laziness) {
    Promise.all(laziness).then(() => {
      fiber.laziness = null
      dispatchUpdate(fiber)
    })
  }
  if (hooks) {
    if (lane & LANE.REMOVE) {
      hooks.list.forEach((e) => e[2] && e[2]())
    } else {
      side(hooks.layout)
      schedule(() => side(hooks.effect))
    }
  }
}

function wireKid(fiber) {
  let kid = fiber
  while (isFn(kid.type) && kid.child) kid = kid.child
  const after = fiber.after || kid.after
  kid.after = after
  kid.lane |= fiber.lane
  let s = kid.sibling
  while (s) {
    s.after = after
    s.lane |= fiber.lane
    s = s.sibling
  }
  return kid
}

const commit = (fiber: IFiber): void => {
  if (!fiber) return
  let { type, lane, parentNode, node, ref } = fiber
  if (isFn(type)) {
    invokeHooks(fiber)
    let kid = wireKid(fiber)
    fiber.node = kid.node
    if (fiber.lane & LANE.REMOVE) {
      commit(kid)
    } else {
      commit(fiber.child)
      commit(fiber.sibling)
    }
    fiber.lane = 0
    return
  }
  if (lane & LANE.REMOVE) {
    kidsRefer(fiber.kids)
    parentNode.removeChild(fiber.node)
    refer(ref, null)
    fiber.lane = 0
    return
  }
  if (lane & LANE.UPDATE) {
    updateElement(node, fiber.oldProps || {}, fiber.props)
  }
  if (lane & LANE.INSERT) {
    parentNode.insertBefore(fiber.node, fiber.after?.node)
  }
  fiber.lane = 0
  refer(ref, node)
  commit(fiber.child)
  commit(fiber.sibling)
}

const same = (a, b) => {
  return getKey(a) === getKey(b) && getType(a) === getType(b)
}

const arrayfy = (arr) => (!arr ? [] : isArr(arr) ? arr : [arr])

const refer = (ref: IRef, dom?: HTMLElement): void => {
  if (ref)
    isFn(ref) ? ref(dom) : ((ref as { current?: HTMLElement })!.current = dom)
}

const kidsRefer = (kids: any): void => {
  kids.forEach((kid) => {
    kid.kids && kidsRefer(kid.kids)
    refer(kid.ref, null)
  })
}

const side = (effects: IEffect[]): void => {
  effects.forEach((e) => e[2] && e[2]())
  effects.forEach((e) => (e[2] = e[0]()))
  effects.length = 0
}

export const getCurrentFiber = () => currentFiber || null
export const isFn = (x: any): x is Function => typeof x === "function"
export const isStr = (s: any): s is number | string =>
  typeof s === "number" || typeof s === "string"
export const some = (v: any) => v != null && v !== false && v !== true
