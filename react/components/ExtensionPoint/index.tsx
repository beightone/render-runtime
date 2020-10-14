import { mergeDeepRight, reduce } from 'ramda'
import React, { FC, Fragment, Suspense, useMemo } from 'react'

import ComponentLoader from './ComponentLoader'
import Loading from '../Loading'
import { useRuntime, RenderContextType } from '../RenderContext'
import { useTreePath } from '../../utils/treePath'
import NoSSR from '../NoSSR'
import { withErrorBoundary } from '../ErrorBoundary'
import GenericPreview from '../Preview/GenericPreview'
import LoadingBar from '../LoadingBar'
import { LazyImages } from '../LazyImages'
import LazyRender from '../LazyRender'

// TODO: Export components separately on @vtex/blocks-inspector, so this import can be simplified
const InspectBlockWrapper = React.lazy(
  () =>
    new Promise<{ default: any }>((resolve) => {
      import('@vtex/blocks-inspector').then((BlocksInspector) => {
        resolve({ default: BlocksInspector.default.ExtensionPointWrapper })
      })
    })
)

interface Props {
  id: string
  key?: string
  params?: any
  query?: any
  preview?: boolean
  treePath?: string
  blockProps?: object
}

function mountTreePath(currentId: string, parentTreePath: string) {
  if (parentTreePath === currentId) {
    return parentTreePath
  }
  if (parentTreePath && currentId) {
    return `${parentTreePath}/${currentId}`
  }
  return parentTreePath || currentId
}

export function getChildExtensions(
  runtime: RenderContextType,
  treePath: string
) {
  const extension = runtime.extensions && runtime.extensions[treePath]

  if (!extension || !extension.blocks) {
    return
  }

  const childBlocks = extension.blocks.filter((block) => {
    /* This weird conditional check is for backwards compatibility.
     * Blocks that were built prior to https://github.com/vtex/builder-hub/pull/856
     * would not have the 'children' property (block.children === undefined).
     */
    const isChild =
      block.children === undefined ||
      block.children === true ||
      block.blockRole === 'children'
    const isNotSlot = block.blockRole !== 'slot'

    return isChild && isNotSlot
  })

  return childBlocks.map((child, i) => {
    const childTreePath = mountTreePath(child.extensionPointId, treePath)

    const childExtension = runtime?.extensions[childTreePath]
    const childProps = childExtension?.props ?? {}

    return (
      <ExtensionPoint
        key={`around-${treePath}-${i}`}
        id={child.extensionPointId}
        blockProps={childProps}
        treePath={treePath}
      />
    )
  })
}

function withOuterExtensions(
  after: string[],
  around: string[],
  before: string[],
  treePath: string,
  props: any,
  element: JSX.Element,
  // TODO: these args are getting ridiculous, maybe group them in an object
  lazyFooter: boolean
) {
  if (before.length === 0 && after.length === 0 && around.length === 0) {
    return element
  }

  const beforeElements = before.map((beforeId) => (
    <ExtensionPoint
      id={beforeId}
      key={beforeId}
      treePath={treePath}
      params={props.params}
      query={props.query}
    />
  ))

  const afterElements = after.map((afterId) => (
    <ExtensionPoint
      id={afterId}
      key={afterId}
      treePath={treePath}
      params={props.params}
      query={props.query}
    />
  ))

  const isRootTreePath = treePath.indexOf('/') === -1

  const wrappedFooter = <LazyImages>{afterElements}</LazyImages>

  const wrapped = (
    <Fragment key={`wrapped-${treePath}`}>
      <LazyImages>{beforeElements}</LazyImages>
      {element}
      {isRootTreePath && <div className="flex flex-grow-1" />}
      {lazyFooter ? <LazyRender>{wrappedFooter}</LazyRender> : wrappedFooter}
    </Fragment>
  )

  return around.reduce((acc, aroundId) => {
    return (
      <ExtensionPoint
        {...props}
        id={aroundId}
        key={aroundId}
        treePath={treePath}
        beforeElements={beforeElements}
        afterElements={afterElements}
      >
        {acc}
      </ExtensionPoint>
    )
  }, wrapped)
}

const ExtensionPoint: FC<Props> = (props) => {
  const runtime = useRuntime()

  const { inspect, getSettings } = runtime

  const treePathFromHook = useTreePath()

  const { children, params, query, id, blockProps, ...parentProps } = props

  const newTreePath = React.useMemo(
    () => mountTreePath(id, props.treePath || treePathFromHook.treePath),
    [id, props.treePath, treePathFromHook.treePath]
  )

  const extension = runtime.extensions && runtime.extensions[newTreePath]

  const {
    component = null,
    after = [],
    around = [],
    before = [],
    content = {},
    render: renderStrategy = null,
    hydration = 'always',
    props: extensionProps = {},
  } = extension || {}

  const appName = component?.substr(0, component.indexOf('@'))
  const appSettings = appName ? getSettings(appName) : {}

  const mergedProps = React.useMemo(() => {
    return reduce(mergeDeepRight, {} as any, [
      appSettings ? { appSettings } : {},
      /** Extra props passed to the ExtensionPoint component
       * e.g. <ExtensionPoint foo="bar" />
       */
      parentProps,
      /** Props that are read from runtime.extensions, that come from the blocks files
       */
      extensionProps,
      /** Props from the blockProps prop, used when the user wants to prevent overriding
       * the native ExtensionPoint props (such as `id`)
       */
      blockProps || {},
      content,
      { params, query },
    ])
  }, [
    parentProps,
    extensionProps,
    blockProps,
    content,
    params,
    query,
    appSettings,
  ])

  const componentChildren = useMemo(() => {
    const isCompositionChildren =
      extension && extension.composition === 'children'

    return isCompositionChildren && extension?.blocks
      ? getChildExtensions(runtime, newTreePath)
      : children
  }, [children, extension, newTreePath, runtime])

  if (
    /* Stops rendering if the extension is not found. Useful for optional ExtensionPoints */
    !extension
  ) {
    return null
  }

  const isRootTreePath = newTreePath.indexOf('/') === -1

  const componentLoader = (
    <ComponentLoader
      component={component}
      props={mergedProps}
      runtime={runtime}
      treePath={newTreePath}
      hydration={hydration}
    >
      {component ? (
        componentChildren
      ) : isRootTreePath ? (
        <GenericPreview />
      ) : (
        <Loading />
      )}
    </ComponentLoader>
  )

  const isLazyFooterEnabled = Boolean(
    getSettings('vtex.store')?.enableLazyFooter
  )

  const extensionPointComponent = withOuterExtensions(
    after,
    around,
    before,
    newTreePath,
    mergedProps,
    componentLoader,
    isLazyFooterEnabled
  )

  /**
   * "client" component assets are sent to server side rendering,
   * but they should display a loading animation.
   * "lazy" components might never be used, so they don't necessarily
   * need a loading animation.
   */
  const maybeClientExtension = (
    <Fragment>
      {runtime.preview && isRootTreePath && <LoadingBar />}
      {renderStrategy === 'client' && !runtime.amp ? (
        <NoSSR onSSR={<Loading />}>{extensionPointComponent}</NoSSR>
      ) : (
        extensionPointComponent
      )}
    </Fragment>
  )

  /** If it's on inspect mode (?__inspect on querystring) wraps the block
   * on a block-inspector wrapper */
  if (inspect) {
    return (
      <Suspense fallback={maybeClientExtension}>
        <InspectBlockWrapper extension={extension} treePath={newTreePath}>
          {maybeClientExtension}
        </InspectBlockWrapper>
      </Suspense>
    )
  }

  return maybeClientExtension
}

ExtensionPoint.defaultProps = {
  blockProps: {},
  treePath: '',
}

export default withErrorBoundary(ExtensionPoint)
