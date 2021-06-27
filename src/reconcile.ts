import {
  IFiber,
  FreElement,
  FC,
  Attributes,
  HTMLElementEx,
  FreNode,
  IEffect,
} from "./type"
import { createElement } from "./dom"
import { resetCursor } from "./hook"
import { schedule, shouldYield, startTransition } from "./schedule"
import { isArr, createText } from "./h"
import { commit } from "./commit"

let currentFiber: IFiber
let finish = null
let effect = null
let detach = null
export let options: any = {}

export const enum LANE {
  UPDATE = 1 << 1,
  INSERT = 1 << 2,
  REMOVE = 1 << 3,
  SVG = 1 << 4,
  DIRTY = 1 << 5,
  SUSPEND = 1 << 6,
  FALLBACK = 1 << 7
}

export const render = (vnode: FreElement, node: Node, config?: any): void => {
  const rootFiber = {
    node,
    props: { children: vnode },
  } as IFiber
  if (config) options = config
  update(rootFiber)
}

export const update = (fiber?: IFiber) => {
  let isSuspend = fiber.lane & LANE.SUSPEND
  if (fiber && !(fiber.lane & LANE.DIRTY)) {
    fiber.lane = LANE.UPDATE | LANE.DIRTY
    if (isSuspend) {
      fiber.lane |= LANE.SUSPEND
    }
    fiber.laziness = []
    schedule(() => {
      fiber.sibling = null
      effect = fiber
      detach = fiber
      reconcile(fiber)
    })
  }
}

const reconcile = (WIP?: IFiber): boolean => {
  while (WIP && !shouldYield()) WIP = capture(WIP)
  if (WIP) return reconcile.bind(null, WIP)
  if (finish) {
    commit(finish)
    finish = null
    options.done && options.done()
  }
  return null
}

const capture = (WIP: IFiber): IFiber | undefined => {
  WIP.laziness = []
  isFn(WIP.type) ? updateHook(WIP) : updateHost(WIP)
  if (WIP.child) return WIP.child
  while (WIP) {
    bubble(WIP)
    if (!finish && WIP.lane & LANE.DIRTY) {
      finish = WIP
      WIP.lane &= ~LANE.DIRTY
      return null
    }
    if (WIP.sibling) return WIP.sibling
    WIP = WIP.parent
  }
}

const bubble = (WIP) => {
  if (isFn(WIP.type)) {
    if (WIP.parent) {
      WIP.parent.laziness = WIP.parent.laziness.concat(WIP.laziness)
    }
    let kid = getKid(WIP)
    if (kid) {
      kid.s = WIP.sibling
      kid.lane |= WIP.lane
    }
    invokeHooks(WIP)
  } else {
    WIP.s = WIP.sibling
    effect.e = WIP
    effect = WIP
  }
}

const isSuspense = (vnode) => vnode.type.name === 'Suspense'

const updateHook = <P = Attributes>(WIP: IFiber): void => {
  resetCursor()
  currentFiber = WIP
  let children = (WIP.type as FC<P>)(WIP.props) as any
  if (isSuspense(WIP)) {
    if ((WIP.lane & LANE.SUSPEND) === 0) {
      const c = simpleVnode(WIP.props.fallback)
      updateLazy(WIP, children)
      children = [c]
    }
  }
  children = simpleVnode(children)
  diffKids(WIP, children)
}

function updateLazy(WIP, children) {
  arrayfy(children).forEach(c => {
    try {
      c.type(c.props)
    } catch (e) {
      if (e && isFn(e.then)) {
        WIP.laziness.push(e)
      }
    }
    if (c.props.children) {
      updateLazy(WIP, c.props.children)
    }
  })
}

const updateHost = (WIP: IFiber): void => {
  WIP.parentNode = getParentNode(WIP) as any
  if (!WIP.node) {
    if (WIP.type === "svg") WIP.lane |= LANE.SVG
    WIP.node = createElement(WIP) as HTMLElementEx
  }
  diffKids(WIP, WIP.props.children)
}

const simpleVnode = (type: any) => {
  return isStr(type) ? createText(type as string) : type
}

const getParentNode = (WIP: IFiber): HTMLElement | undefined => {
  while ((WIP = WIP.parent)) {
    if (!isFn(WIP.type)) return WIP.node
  }
}

export const getKid = (WIP: IFiber) => {
  while ((WIP = WIP.child)) {
    if (!isFn(WIP.type)) return WIP
  }
}

const diffKids = (WIP: any, children: FreNode): void => {
  let aCh = WIP.kids || [],
    bCh = (WIP.kids = arrayfy(children) as any),
    aHead = 0,
    bHead = 0,
    aTail = aCh.length - 1,
    bTail = bCh.length - 1,
    keyed = null

  while (aHead <= aTail && bHead <= bTail) {
    if (!same(aCh[aTail], bCh[bTail])) break
    clone(aCh[aTail--], bCh[bTail], LANE.UPDATE, WIP, bTail--)
  }

  while (aHead <= aTail && bHead <= bTail) {
    if (!same(aCh[aHead], bCh[bHead])) break
    aHead++; bHead++
  }

  if (aHead > aTail) {
    while (bHead <= bTail) {
      let c = bCh[bTail]
      c.lane = LANE.INSERT
      linke(c, WIP, bTail--)
    }
  } else if (bHead > bTail) {
    while (aHead <= aTail) {
      let c = aCh[aTail--]
      c.lane = LANE.REMOVE
      detach.d = c
      detach = c
    }
  } else {
    if (!keyed) {
      keyed = {}
      for (let i = aHead; i <= aTail; i++) {
        let k = aCh[i].key || '.' + i
        if (k) keyed[k] = i
      }
    }
    while (bHead <= bTail) {
      let c = bCh[bTail]
      let idx = keyed[c.key || '.' + bTail]
      if (idx != null && same(c, aCh[idx])) {
        clone(aCh[idx], c, LANE.INSERT, WIP, bTail--)
        delete keyed[c.key]
      } else {
        c.lane = LANE.INSERT
        linke(c, WIP, bTail--)
      }
    }

    for (const k in keyed) {
      let c = aCh[keyed[k]]
      c.lane = LANE.REMOVE
      detach.d = c
      detach = c
    }
  }

  while (bHead-- > 0) {
    clone(aCh[bHead], bCh[bHead], LANE.UPDATE, WIP, bHead)
  }
}

function linke(kid, WIP, i) {
  kid.parent = WIP
  if (i === WIP.kids.length - 1) {
    if (WIP.lane & LANE.SVG) {
      kid.lane |= LANE.SVG
    }
    WIP.child = kid
  } else {
    WIP._prev.sibling = kid
  }
  WIP._prev = kid
}

function clone(a, b, lane, WIP, i) {
  b.oldProps = a.props
  b.node = a.node
  b.kids = a.kids
  b.hooks = a.hooks
  b.ref = a.ref
  b.lane = lane
  linke(b, WIP, i)
}


function invokeHooks(fiber) {
  const { hooks, laziness } = fiber
  if (hooks) {
    side(hooks.layout)
    startTransition(() => side(hooks.effect))
  }
  if (laziness.length > 0) {
    if (isSuspense(fiber)) {
      console.log(fiber)
      fiber.lane |= LANE.SUSPEND
      Promise.all(laziness).then(() => update(fiber))
    }
  }
}

const same = (a, b) => {
  return a && b && a.key === b.key && a.type === b.type
}

export const arrayfy = (arr) => (!arr ? [] : isArr(arr) ? arr : [arr])

const side = (effects: IEffect[]): void => {
  effects.forEach((e) => e[2] && e[2]())
  effects.forEach((e) => (e[2] = e[0]()))
  effects.length = 0
}

export const getCurrentFiber = () => currentFiber || null
export const isFn = (x: any): x is Function => typeof x === "function"
export const isStr = (s: any): s is number | string =>
  typeof s === "number" || typeof s === "string"