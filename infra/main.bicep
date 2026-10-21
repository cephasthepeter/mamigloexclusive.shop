targetScope = 'resourceGroup'

@description('Short label used to create globally unique resource names.')
@minLength(3)
@maxLength(16)
param environmentName string = 'mamiglo'

@description('Choose a region supported by Flex Consumption and Cosmos DB. South Africa North is a nearby option for Nigeria; check current regional availability before deployment.')
@allowed([
  'australiaeast'
  'australiasoutheast'
  'brazilsouth'
  'canadacentral'
  'centralindia'
  'centralus'
  'eastasia'
  'eastus'
  'eastus2'
  'francecentral'
  'germanywestcentral'
  'italynorth'
  'japaneast'
  'koreacentral'
  'northcentralus'
  'northeurope'
  'norwayeast'
  'southafricanorth'
  'southcentralus'
  'southeastasia'
  'southindia'
  'spaincentral'
  'swedencentral'
  'uaenorth'
  'uksouth'
  'ukwest'
  'westcentralus'
  'westeurope'
  'westus'
  'westus2'
  'westus3'
])
param location string = 'southafricanorth'

@description('Set true only after confirming that this subscription can use its one lifetime Cosmos DB free-tier account.')
param enableCosmosFreeTier bool = true

var suffix = take(toLower(uniqueString(resourceGroup().id, environmentName, location)), 8)
var functionName = 'func-mgx-${suffix}'
var staticSiteName = 'swa-mgx-${suffix}'
var cosmosName = 'cosmos-mgx-${suffix}'
var storageName = 'stmgx${suffix}'
var databaseName = 'mamigloexclusive'
var storeContainerName = 'store'
var imageContainerName = 'product-images'
var deploymentContainerName = 'function-packages'
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'
var blobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'

resource staticSite 'Microsoft.Web/staticSites@2024-11-01' = {
  name: staticSiteName
  location: 'eastus2'
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    defaultToOAuthAuthentication: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storage
  name: 'default'
}

resource imageContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: imageContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-mgx-api-${suffix}'
  location: location
}

resource flexPlan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: 'plan-mgx-${suffix}'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: enableCosmosFreeTier
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
  }
}

resource storeDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2025-04-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
    options: {
      throughput: 400
    }
  }
}

resource storeContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: storeDatabase
  name: storeContainerName
  properties: {
    resource: {
      id: storeContainerName
      partitionKey: {
        paths: [
          '/partitionKey'
        ]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
      }
    }
  }
}

resource apiApp 'Microsoft.Web/sites@2024-11-01' = {
  name: functionName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: flexPlan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: apiIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        instanceMemoryMB: 512
        maximumInstanceCount: 10
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
    siteConfig: {
      alwaysOn: false
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'AzureWebJobsStorage__clientId'
          value: apiIdentity.properties.clientId
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'AZURE_CLIENT_ID'
          value: apiIdentity.properties.clientId
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmos.properties.documentEndpoint
        }
        {
          name: 'COSMOS_DATABASE'
          value: databaseName
        }
        {
          name: 'COSMOS_CONTAINER'
          value: storeContainerName
        }
        {
          name: 'DEMO_MODE'
          value: 'false'
        }
        {
          name: 'DELIVERY_FEE_NGN'
          value: '0'
        }
        {
          name: 'ALLOWED_ORIGIN'
          value: 'https://${staticSite.properties.defaultHostname}'
        }
        {
          name: 'PUBLIC_API_BASE_URL'
          value: 'https://${functionName}.azurewebsites.net/api'
        }
        {
          name: 'AZURE_STORAGE_ACCOUNT_URL'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'AZURE_STORAGE_CONTAINER'
          value: imageContainerName
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: ''
        }
        {
          name: 'ENTRA_API_CLIENT_ID'
          value: ''
        }
        {
          name: 'ADMIN_EMAILS'
          value: ''
        }
      ]
    }
  }
  dependsOn: [
    imageContainer
    deploymentContainer
    blobDataRole
    cosmosDataRole
  ]
}

resource blobDataRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, apiIdentity.properties.principalId, blobDataOwnerRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataOwnerRoleId)
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2025-04-15' = {
  parent: cosmos
  name: guid(cosmos.id, apiIdentity.properties.principalId, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: apiIdentity.properties.principalId
    scope: '${cosmos.id}/dbs/${databaseName}'
  }
  dependsOn: [
    storeDatabase
  ]
}

output staticSiteName string = staticSite.name
output staticSiteUrl string = 'https://${staticSite.properties.defaultHostname}'
output functionAppName string = apiApp.name
output functionAppUrl string = 'https://${apiApp.properties.defaultHostName}'
output apiBaseUrl string = 'https://${apiApp.properties.defaultHostName}/api'
output cosmosAccountName string = cosmos.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output storageAccountName string = storage.name
