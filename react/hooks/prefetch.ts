import {
  PrefetchState,
  usePrefetch,
  getCacheForPage,
} from '../components/Prefetch/PrefetchContext'
import {
  queryStringToMap,
  NavigateOptions,
  getNavigationRouteToNavigate,
} from '../utils/pages'
import {
  getPrefetchForPath,
  fetchRouteData,
  isPrefetchActive,
} from '../utils/routes'
import { fetchComponents } from '../utils/components'
import { useRuntime } from '../components/RenderContext'
import { useApolloClient } from 'react-apollo'
import { useRef, useEffect, useCallback, MutableRefObject } from 'react'
import { useOnView } from './viewDetection'
import { ApolloClientType } from '../typings/global'
import { RenderRuntime } from '../typings/runtime'

interface PrefetchRequestsArgs {
  client: ApolloClientType
  navigationRoute: any
  page?: string
  pages: RenderRuntime['pages']
  prefetchState: PrefetchState
  hints: RenderRuntime['hints']
  renderMajor: RenderRuntime['renderMajor']
  validCache: {
    pathValid: boolean
    routeValid: boolean
  }
  storeSettings: Record<string, any>
}

const getPageToNavigate = (path: string, query: string) => {
  return getPrefetchForPath({
    path: path,
    fetcher: fetch,
    query: queryStringToMap(query),
  })
}

interface MaybeUpdatePathArgs {
  prefetchState: PrefetchState
  navigationRoute: any
  validCache: {
    pathValid: boolean
    routeValid: boolean
  }
  page?: string
}

const maybeUpdatePathCache = async ({
  prefetchState,
  navigationRoute,
  validCache,
  page,
}: MaybeUpdatePathArgs) => {
  const { pathsState } = prefetchState
  if (validCache.pathValid) {
    return pathsState[navigationRoute.path].page as string
  }

  const navigationData = await getPageToNavigate(
    navigationRoute.path,
    navigationRoute.query
  )

  const navigationPage = page ?? navigationData?.page
  pathsState[navigationRoute.path] = { fetching: false, page: navigationPage }
  if (navigationData == null || navigationPage == null) {
    return null
  }

  const cacheObj = {
    routeId: navigationPage,
    matchingPage: navigationData.route,
    contentResponse: navigationData.contentResponse,
    queryData: navigationData.queryData,
  }

  const cache = getCacheForPage(navigationPage)

  cache.set(navigationRoute.path, cacheObj)
  return navigationPage
}

const prefetchRequests = async ({
  client,
  navigationRoute,
  page,
  pages,
  prefetchState,
  hints,
  renderMajor,
  validCache,
  storeSettings,
}: PrefetchRequestsArgs) => {
  const { pathsState, routesCache, routePromise } = prefetchState
  if (!isPrefetchActive(storeSettings)) {
    return
  }

  const navigationPage = await maybeUpdatePathCache({
    prefetchState,
    navigationRoute,
    validCache,
    page,
  })

  pathsState[navigationRoute.path] = { fetching: false, page: navigationPage }
  if (navigationPage == null) {
    return
  }

  const declarer = pages[navigationPage]?.declarer
  if (typeof declarer === 'undefined') {
    // Should not happen, but lets be safe
    return
  }

  let routeDataCache = routesCache.get(navigationPage)
  const routePromiseValue = routePromise[navigationPage]

  if (!routeDataCache && !routePromiseValue) {
    const newState = {
      promisePending: true,
      promise: fetchRouteData({
        apolloClient: client,
        routeId: navigationPage,
        declarer,
        hints,
        renderMajor,
      }),
    }
    newState.promise
      .then((data) => {
        routesCache.set(navigationPage, data)
      })
      .finally(() => {
        newState.promisePending = false
        newState.promise = null as any
        routePromise[navigationPage] = null
      })

    routePromise[navigationPage] = newState
  }
  const globalRouteDataState = routePromise[navigationPage]
  if (globalRouteDataState?.promisePending) {
    await globalRouteDataState.promise
    routeDataCache = routesCache.get(navigationPage)
  }

  if (!routeDataCache) {
    return
  }

  await fetchComponents(
    routeDataCache.components,
    window.__RUNTIME__,
    routeDataCache.extensions
  )
}

interface UsePrefetchArgs {
  ref: MutableRefObject<HTMLElement | null>
  page?: string
  href: string
  options: NavigateOptions
  waitToPrefetch?: number
}

// Returns an object that for a given path, tells us if the routes or path cache has valid data for the given input.
// We do this to know when to hit the server. Will return false (as invalid data) if cached data has expired its max age.
const getCacheValidData = (path: string, prefecthState: PrefetchState) => {
  const { pathsState, routesCache } = prefecthState
  const page = pathsState[path]?.page

  if (!page) {
    return {
      pathValid: false,
      routeValid: false,
    }
  }

  const cache = getCacheForPage(page)
  const validData = cache.has(path)
  const validRoutesData = routesCache.has(page)
  return {
    pathValid: validData,
    routeValid: validRoutesData,
  }
}

const getPriorityForPage = (page: string | undefined) =>
  page === 'store.product' ? 1 : 0

export const useIsPrefetchActive = () => {
  const { getSettings } = useRuntime()
  const storeSettings = getSettings('vtex.store')
  return isPrefetchActive(storeSettings)
}

export const usePrefetchAttempt = ({
  ref,
  page,
  href,
  options,
  waitToPrefetch,
}: UsePrefetchArgs) => {
  const runtime = useRuntime()
  const prefetchState = usePrefetch()
  const client = useApolloClient() as ApolloClientType
  const hasTried = useRef(false)
  const canPrefetch = useRef(!waitToPrefetch || waitToPrefetch === 0)

  useEffect(() => {
    if (!canPrefetch.current) {
      setTimeout(() => {
        canPrefetch.current = true
      }, waitToPrefetch)
    }
  }, [canPrefetch, waitToPrefetch])

  const {
    pages,
    navigationRouteModifiers,
    hints,
    renderMajor,
    getSettings,
  } = runtime
  const storeSettings = getSettings('vtex.store')

  const attemptPrefetch = useCallback(() => {
    if (
      hasTried.current ||
      !isPrefetchActive(storeSettings) ||
      !canPrefetch.current
    ) {
      return
    }

    const { pathsState, queue } = prefetchState
    if (href && href[0] !== '/') {
      // Should only work on relative paths
      return
    }

    options.modifiers = navigationRouteModifiers
    const navigationRoute = getNavigationRouteToNavigate(pages, options)
    navigationRoute.original = options.to

    if (pathsState[navigationRoute.path]?.fetching) {
      // already fetching, no need to go any further
      hasTried.current = true
      return
    }

    const validCache = getCacheValidData(navigationRoute.path, prefetchState)

    if (validCache.pathValid && validCache.routeValid) {
      // cache all valid, no need to fetch anything
      hasTried.current = true
      return
    }

    if (!validCache.pathValid) {
      pathsState[navigationRoute.path] = { fetching: true }
    }

    const priority = getPriorityForPage(page)
    hasTried.current = true

    queue.add(
      async () =>
        prefetchRequests({
          client,
          navigationRoute,
          page,
          pages,
          prefetchState,
          hints,
          renderMajor,
          validCache,
          storeSettings,
        }),
      { priority }
    )
  }, [
    client,
    hints,
    href,
    navigationRouteModifiers,
    options,
    page,
    pages,
    prefetchState,
    renderMajor,
    storeSettings,
  ])

  useOnView({
    ref,
    onView: ({ unobserve }) => {
      /** Uses a setTimeout to prevent creating huge tasks,
       * if prefetchs accumulate.
       * Google "Total Blocking Time" for more info.
       */
      setTimeout(() => {
        if (!canPrefetch.current) {
          /** If canPrefetch is false, might be able to retry
           * later, so doesn't "unobserve" yet, just return */
          return
        }

        attemptPrefetch()
        unobserve()
      }, 1)
    },
    bailOut: !hints.mobile,
    threshold: 0.75,
  })

  const executePrefetch = useCallback(() => {
    if (hints.desktop) {
      attemptPrefetch()
    }
  }, [attemptPrefetch, hints.desktop])

  return executePrefetch
}
