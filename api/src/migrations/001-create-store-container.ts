import { CosmosClient, PartitionKeyKind } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'

const endpoint = process.env.COSMOS_ENDPOINT
if (!endpoint) throw new Error('Set COSMOS_ENDPOINT before running the Cosmos DB migration.')

const client = process.env.COSMOS_KEY
  ? new CosmosClient({ endpoint, key: process.env.COSMOS_KEY })
  : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() })

const databaseId = process.env.COSMOS_DATABASE || 'mamigloexclusive'
const containerId = process.env.COSMOS_CONTAINER || 'store'
const { database } = await client.databases.createIfNotExists({ id: databaseId, throughput: 400 })
await database.containers.createIfNotExists({
  id: containerId,
  partitionKey: { paths: ['/partitionKey'], kind: PartitionKeyKind.Hash },
})
console.log(`Cosmos DB container "${databaseId}/${containerId}" is ready.`)
