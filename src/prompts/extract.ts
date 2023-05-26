import { AIPrompt } from '../text/index.js';

import flow from 'lodash/fp/flow.js';
import uniqBy from 'lodash/fp/uniqBy.js';
import reject from 'lodash/fp/reject.js';
import uniq from 'lodash/fp/uniq.js';
import map from 'lodash/fp/map.js';
import join from 'lodash/fp/join.js';
import isEmpty from 'lodash/fp/isEmpty.js';

export enum BusinessInfo {
  // Product stuff
  ProductName = 'Product Name',
  ProductDescription = 'Product Description',
  ProductModelNumber = 'Product Model Number',
  ProductSerialNumber = 'Product Serial Number',
  ProductPurchaseDate = 'Product Purchase Date',

  // Purchases
  OrderID = 'Order ID',
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

  constructor(entities: ExtractEntity[]) {
    super({
      stopSequences: ['Text:'],
      responseConfig: { keyValue: true },
    });

    if (isEmpty(entities)) {
      throw new Error(`No info defined to extract`);
    }

    // unique names and classes
    this.entityValue = flow(
      reject((v: ExtractEntity) => v.name === 'Text'),
      map((v) => ({ ...v, name: v.name?.trim().replace(/[^a-zA-Z ]+/, '') })),
      uniqBy((v) => v.name),
      map((v) => (v.classes ? [v.name, uniq(v.classes).join(',')] : [v.name])),
      map(([n, c]) => `${n}:${c ? ` [${c}]` : ``}`),
      join('\n')
    )(entities);
  }

  create(query: string, system: string): string {
    return `
${system}
Extract the following entities mentioned in the text below. Use N/A if entity is not found::
${this.entityValue}

Text: 
${query}
`;
  }
}
