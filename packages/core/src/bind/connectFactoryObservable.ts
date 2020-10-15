import { Observable } from "rxjs"
import shareLatest from "../internal/share-latest"
import reactEnhancer from "../internal/react-enhancer"
import { BehaviorObservable } from "../internal/BehaviorObservable"
import { useObservable } from "../internal/useObservable"
import { EMPTY_VALUE } from "../internal/empty-value"
import { SUSPENSE } from "../SUSPENSE"

/**
 * Accepts: A factory function that returns an Observable.
 *
 * Returns [1, 2]
 * 1. A React Hook function with the same parameters as the factory function.
 *  This hook will yield the latest update from the observable returned from
 *  the factory function.
 * 2. A `sharedLatest` version of the observable generated by the factory
 *  function that can be used for composing other streams that depend on it.
 *  The shared subscription is closed as soon as there are no subscribers to
 *  that observable.
 *
 * @param getObservable Factory of observables. The arguments of this function
 *  will be the ones used in the hook.
 *
 * @remarks If the Observable doesn't synchronously emit a value upon the first
 * subscription, then the hook will leverage React Suspense while it's waiting
 * for the first value.
 */
export default function connectFactoryObservable<A extends [], O>(
  getObservable: (...args: A) => Observable<O>,
  defaultValue: O = EMPTY_VALUE,
): [
  (...args: A) => Exclude<O, typeof SUSPENSE>,
  (...args: A) => Observable<O>,
] {
  const cache = new NestedMap<A, [BehaviorObservable<O>, () => O]>()

  const getSharedObservables$ = (
    input: A,
  ): [BehaviorObservable<O>, () => O] => {
    for (let i = input.length - 1; input[i] === undefined && i > -1; i--) {
      input.splice(-1)
    }
    const keys = ([input.length, ...input] as any) as A
    const cachedVal = cache.get(keys)

    if (cachedVal !== undefined) {
      return cachedVal
    }

    const sharedObservable$ = shareLatest(
      getObservable(...input),
      false,
      () => {
        cache.delete(keys)
      },
    )

    const publicShared$ = new Observable<O>((subscriber) => {
      const inCache = cache.get(keys)
      let source$: BehaviorObservable<O> = sharedObservable$

      if (!inCache) {
        cache.set(keys, result)
      } else if (inCache[0] !== publicShared$) {
        source$ = inCache[0]
        publicShared$.getValue = source$.getValue
      }

      return source$.subscribe(subscriber)
    }) as BehaviorObservable<O>
    publicShared$.getValue = sharedObservable$.getValue
    const reactGetValue = reactEnhancer(publicShared$, defaultValue)

    const result: [BehaviorObservable<O>, () => O] = [
      publicShared$,
      reactGetValue,
    ]

    cache.set(keys, result)
    return result
  }

  return [
    (...input: A) => {
      const [source$, getValue] = getSharedObservables$(input)
      return useObservable(source$, getValue, input)
    },
    (...input: A) => getSharedObservables$(input)[0],
  ]
}

class NestedMap<K extends [], V extends Object> {
  private root: Map<K, any>
  constructor() {
    this.root = new Map()
  }

  get(keys: K[]): V | undefined {
    let current: any = this.root
    for (let i = 0; i < keys.length; i++) {
      current = current.get(keys[i])
      if (!current) return undefined
    }
    return current
  }

  set(keys: K[], value: V): void {
    let current: Map<K, any> = this.root
    let i
    for (i = 0; i < keys.length - 1; i++) {
      let nextCurrent = current.get(keys[i])
      if (!nextCurrent) {
        nextCurrent = new Map<K, any>()
        current.set(keys[i], nextCurrent)
      }
      current = nextCurrent
    }
    current.set(keys[i], value)
  }

  delete(keys: K[]): void {
    const maps: Map<K, any>[] = [this.root]
    let current: Map<K, any> = this.root

    for (let i = 0; i < keys.length - 1; i++) {
      maps.push((current = current.get(keys[i])))
    }

    let mapIdx = maps.length - 1
    maps[mapIdx].delete(keys[mapIdx])

    while (--mapIdx > -1 && maps[mapIdx].get(keys[mapIdx]).size === 0) {
      maps[mapIdx].delete(keys[mapIdx])
    }
  }
}
