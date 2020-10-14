import React, {
  useRef,
  useEffect,
  useState,
  ReactNode,
  useLayoutEffect,
  FunctionComponent,
} from 'react'
import { traverseExtension } from '../../utils/components'
import { fetchAssets, getImplementation } from '../../utils/assets'
import { useDehydratedContent } from '../../hooks/hydration'
import { canUseDOM } from 'exenv'
import { useRuntime } from '../RenderContext'
import { RenderRuntime } from '../../typings/runtime'

interface Props {
  shouldHydrate?: boolean
  children: ReactNode
  treePath: string
}

/** TODO: sometimes, the assets seem to load successfuly, but the component
 * implementation is not ready yet. This function works as a guarantee, but
 * need to understand it fully how it works so this verification can be avoided
 */
async function verifyComponentImplementation(
  runtime: RenderRuntime,
  treePath: string,
  retries = 10
): Promise<boolean> {
  const component = runtime?.extensions?.[treePath]?.component

  const componentImplementation = component && getImplementation(component)

  if (componentImplementation) {
    return true
  }

  if (retries > 0) {
    const timeout = 1100 - retries * 100
    await new Promise((resolve) => setTimeout(resolve, timeout))
    const result = await verifyComponentImplementation(
      runtime,
      treePath,
      retries - 1
    )

    return result
  }
  throw new Error(`Unable to fetch component ${component}`)
}

function loadAssets(runtime: RenderRuntime, treePath: string) {
  if (canUseDOM) {
    const extensionAssets = traverseExtension(
      runtime.extensions,
      runtime.components,
      treePath,
      true
    )

    return new Promise((resolve) => {
      fetchAssets(runtime, extensionAssets).then(() => {
        verifyComponentImplementation(runtime, treePath).then(resolve)
      })
    })
  }
  return new Promise(() => {})
}

/** document.querySelector[All] throws if the selector is malformed.
 * Since we are dealing with dynamic selectors here, it's best to be safe.
 */
function safeQuerySelectorAll<T extends Element>(selector: string) {
  try {
    return document.querySelectorAll<T>(selector)
  } catch (e) {
    console.error(e)
    return []
  }
}

function safeQuerySelector<T extends Element>(selector: string) {
  try {
    return document.querySelector<T>(selector)
  } catch (e) {
    console.error(e)
    return null
  }
}

const useAssetLoading = (extensionPointId?: string, shouldLoad?: boolean) => {
  const runtime = useRuntime()
  const isSSR = !canUseDOM
  const [isLoaded, setIsLoaded] = useState(isSSR)

  useEffect(() => {
    if (!isLoaded && extensionPointId && shouldLoad) {
      loadAssets((runtime as unknown) as RenderRuntime, extensionPointId).then(
        () => {
          setIsLoaded(true)
        }
      )
    }
  }, [isLoaded, extensionPointId, shouldLoad, runtime])

  return { isLoaded }
}

/** Prevents images from turning lazy again after re-rendering the component,
 * to prevent them from flickering. */
const useEagerImages = (treePath: string, shouldMakeImagesEager?: boolean) => {
  const alreadyLoadedImages = useRef([] as HTMLImageElement[])
  if (shouldMakeImagesEager) {
    /**  Stores which descendant images were already lazyloaded.
     * Those images will be set to load eagerly down below on the useLayoutEffect hook.
     * This prevents them from blinking. */
    const images = safeQuerySelectorAll<HTMLImageElement>(
      `[data-hydration-id="${treePath}"] img.lazyloaded`
    )

    alreadyLoadedImages.current = Array.from(images)
  }

  useLayoutEffect(() => {
    if (!shouldMakeImagesEager) {
      return
    }

    const images = alreadyLoadedImages.current.map((image) =>
      safeQuerySelector<HTMLImageElement>(`img[data-src="${image.src}"]`)
    )

    if (!images) {
      return
    }

    for (const image of images) {
      if (!image) {
        continue
      }
      image.classList.remove('lazyload')
      image.setAttribute('loading', 'eager')
      const dataSrc = image.getAttribute('data-src')
      if (!image.src && dataSrc) {
        image.src = dataSrc
      }
    }
  }, [treePath, shouldMakeImagesEager])
}

const PreventHydration: FunctionComponent<Props> = ({
  children,
  shouldHydrate,
  treePath,
}) => {
  const initialShouldHydrate = useRef(shouldHydrate)

  const { hasRenderedOnServer } = useDehydratedContent(treePath)

  const shouldRenderImmediately =
    !hasRenderedOnServer ||
    (shouldHydrate && shouldHydrate === initialShouldHydrate.current)

  const { isLoaded } = useAssetLoading(
    treePath,
    shouldRenderImmediately || shouldHydrate
  )
  const shouldMakeImagesEager =
    shouldHydrate && !shouldRenderImmediately && isLoaded

  /** Prevents images from turning lazy again after re-rendering the component,
   * to prevent them from flickering. */
  useEagerImages(treePath, shouldMakeImagesEager)

  const containerProps = {
    'data-hydration-id': treePath,
    style: {
      display: 'contents',
    },
  }

  if (!isLoaded && !hasRenderedOnServer) {
    return <div {...containerProps} />
  }

  if (shouldRenderImmediately) {
    return <div {...containerProps}>{children}</div>
  }

  return shouldHydrate && isLoaded ? (
    <div {...containerProps}>{children}</div>
  ) : (
    /** This is the heart of this component (and it's a hack):
     * In order to "prevent hydration", it renders the same div as the other
     * return paths, but setting its innerHTML as an empty string. This makes
     * React not touch the div's content, as it's "out of its domain" since
     * it's a custom HTML it knows nothing about. So the effect is that the
     * HTML that comes from the server is kept.
     * This behaviour will (probably?) come from React itself in the future,
     * so this hack is supposed to be temporary.
     */
    <div
      {...containerProps}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: '',
      }}
    />
  )
}

PreventHydration.displayName = 'PreventHydration'

export default React.memo(PreventHydration)
