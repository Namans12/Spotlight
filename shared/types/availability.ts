export type AvailabilityType = 'subscription' | 'free' | 'ads' | 'rent' | 'buy';
export interface ProviderOffer {
  provider: string;
  type: AvailabilityType;
}
