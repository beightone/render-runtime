import {ApolloLink, NextLink, Observable, Operation, RequestHandler} from 'apollo-link'
import {canUseDOM} from 'exenv'
import {ArgumentNode, BREAK, DirectiveNode, DocumentNode, OperationDefinitionNode, visit} from 'graphql'

const assetsFromQuery = (query: DocumentNode) => {
  const assets = {operationType: 'mutation'}
  visit(query, {
    OperationDefinition (node: OperationDefinitionNode) {
      assets.operationType = node.operation
      return BREAK
    }
  })
  return assets
}

interface OperationContext {
  fetchOptions: any,
  runtime: RenderRuntime,
}

const defaultAssets = {
  maxAge: 'LONG',
  scope: 'public',
  version: 1
}

const hashFromExtensions = ext => ext && ext.persistedQuery && ext.persistedQuery.sha256Hash

export const createUriSwitchLink = (baseURI: string, runtime: RenderRuntime) =>
  new ApolloLink((operation: Operation, forward?: NextLink) => {
    const {workspace, cacheHints} = runtime
    const hash = hashFromExtensions(operation.extensions)
    const {maxAge, scope, version} = cacheHints[hash] || defaultAssets

    console.log('these are the assets', maxAge, scope, version)

    const {operationType} = assetsFromQuery(operation.query)
    const protocol = canUseDOM ? 'https:' : 'http:'
    operation.setContext(({ fetchOptions = {}, runtime: {appsEtag} } : OperationContext) => {
      const method = (scope.toLowerCase() === 'public' && operationType.toLowerCase() === 'query') ? 'GET' : 'POST'
      return {
        ...operation.getContext(),
        fetchOptions: {...fetchOptions, method},
        uri: `${protocol}//${baseURI}/_v/graphql/${scope}/v${version}?workspace=${workspace}&maxAge=${maxAge}&appsEtag=${appsEtag}`,
      }
    })
    return forward ? forward(operation) : null
  })
