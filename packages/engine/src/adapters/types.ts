import type { ModelRecord, ProviderDefinition, Protocol, TestResult } from '@cameleon/shared';

export interface AdapterInput {
  def: ProviderDefinition;
  /** Non-secret field values (baseUrl, organization…). */
  fields: Record<string, string>;
  /** Secret field values from the vault (apiKey, customHeaders). */
  secrets: Record<string, string>;
}

/** What an adapter reports for one model. `providerId`, `syncedAt` are added by the registry service. */
export type DiscoveredModel = Omit<ModelRecord, 'providerId' | 'syncedAt' | 'origin' | 'status'> & {
  origin?: ModelRecord['origin'];
  status?: ModelRecord['status'];
};

export type TestOutcome = Omit<TestResult, 'checkedAt'>;

export interface ProviderAdapter {
  readonly protocol: Protocol;
  /** Cheap, non-billable authenticated request. Must never throw: failures are returned. */
  test(input: AdapterInput): Promise<TestOutcome>;
  /** Fetch the model catalog. Throws HttpError on failure. */
  discover(input: AdapterInput): Promise<DiscoveredModel[]>;
}
