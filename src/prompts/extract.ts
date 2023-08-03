import { AIPrompt } from '../text/text.js';

export enum BusinessInfo {
  // Product stuff
  ProductName = 'Product Name',
  ProductDescription = 'Product Description',
  ProductModelNumber = 'Product Model Number',
  ProductSerialNumber = 'Product Serial Number',
  ProductPurchaseDate = 'Product Purchase Date',

  // Purchases
  OrderId = 'Order Id',
  OrderQuantity = 'Order Quantity',
  AccountNumber = 'Account Number',
  ShippingAddress = 'Shipping Address',
  BillingAddress = 'Billing Address',
  PaymentMethod = 'Payment method',

  // SupportInfo
  CustomerName = 'Senders Name',
  CustomerEmail = 'Senders Email',
  CustomerPhone = 'Senders Phone',
  ContactInformation = 'Sender Contact Information',
  IssueClass = 'Issue Class',
  IssueDescription = 'Issue Description',
  IssueSummary = 'Issue Summary',
  ErrorMessage = 'Error Message',
  TroubleshootingStepsTaken = 'Troubleshooting Steps Taken',
  SupportTicketNumber = 'Support Ticket Number',
  SupportAgentName = 'Support Agent Name',
  Feedback = 'Feedback',
  OrderDetailsIncluded = 'Order Details Included',
  ShippingDetailsIncluded = 'Shipping Details Included',
  Priority = 'Priority',
}

/**
 * Values to extract
 * @export
 */
export type ExtractEntity = {
  name: BusinessInfo | string;
  classes?: string[];
};

/**
 * A prompt used for extracting information from customer support interactions
 * @export
 */
export class ExtractInfoPrompt extends AIPrompt<Map<string, string[]>> {
  private entityValue: string;

  constructor(entities: readonly ExtractEntity[]) {
    super({
      stopSequences: ['Text:'],
      responseConfig: { keyValue: true },
    });

    if (entities.length === 0) {
      throw new Error(`No info defined to extract`);
    }

    // unique names and classes
    this.entityValue = entities
      // Remove the entity if its name is 'Text'
      .filter((v: Readonly<ExtractEntity>) => v.name !== 'Text')

      // For each entity, trim any non-alphabetical character from the name
      .map((v: Readonly<ExtractEntity>) => ({
        ...v,
        name: v.name?.trim().replace(/[^a-zA-Z ]+/, ''),
      }))

      // Remove duplicate entities based on the name
      .filter(
        (v: Readonly<ExtractEntity>, i: number, a: readonly ExtractEntity[]) =>
          a.findIndex((t) => t.name === v.name) === i
      )

      // For each entity, create an array where the first item is the name and
      // the second item is a comma-separated list of unique classes (if any)
      // if classes don't exist, an empty string is used
      .map((v: Readonly<ExtractEntity>): [string, string] => [
        v.name || '',
        v.classes ? Array.from(new Set(v.classes)).join(',') : '',
      ])

      // Transform the arrays into strings in the format `name: [classes]`
      // Here, the type [string, string] is assured
      .map(([n, c]: Readonly<[string, string]>) => `${n}${c ? `: [${c}]` : ``}`)

      // Join all the strings together with line breaks in between
      .join('\n');
  }

  override prompt(query: string): string {
    return `
Extract the following entities mentioned in the text below. Use N/A if entity is not found::
${this.entityValue}

Text: 
${query}
`;
  }
}
