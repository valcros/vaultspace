# ACS delivery monitoring

The SysOp Email Delivery page and `/api/sysop/email-delivery` show provider-reported failures after Azure Communication Services has accepted a send. Both require platform operator access and `SYSOP_OVERVIEW_READ`. They show the latest 100 failures within the Azure Monitor retention window and omit recipient local parts, message content, and raw provider failure messages.

## Azure setup

1. Enable the ACS CommunicationServices `allLogs` diagnostic setting to a Log Analytics workspace. The `ACSEmailStatusUpdateOperational` table must contain records with `_ResourceId`.
2. Set the workspace access mode to **Use resource or workspace permissions**. Assign the web app managed identity `Reader` on the specific ACS CommunicationServices resource. Do not grant access to the whole workspace for this feature.
3. Set `ACS_COMMUNICATION_RESOURCE_ID` on the web container to the full ARM resource ID. The page uses the resource-context Logs Query API, so it does not need a workspace ID.
4. Validate a provider-reported failure using the SysOp page or API. A successful submission alone will not appear as a delivery failure.
5. Deploy `infrastructure/acs-delivery-failure-alert.json` to create an Azure Monitor rule that evaluates failure statuses every five minutes. The template has no email action group. Inspect alert history in Azure Monitor and decide separately whether a secure operations destination should receive notifications.

The current implementation reads ACS status on demand. It does not change message lifecycle records or the mailbox that receives nondelivery reports. The Event Grid shadow ingestion path has separate activation gates and is not used by this view.

## Diagnosis policy

SMTP `550 5.7.1` means the receiving server refused a message under policy. The sender cannot infer the recipient's private rule from this code. Explain known DNS and SMTP causes deterministically. Any future LLM adapter should receive only the bounded observation fields exposed by the SysOp API and must label its output as a hypothesis. Provider status and SMTP codes remain the evidence of record. The observation type is provider-neutral so a standalone installation can add an SMTP or webhook source without changing the operator view.

## References

- [ACS email logs](https://learn.microsoft.com/en-us/azure/communication-services/concepts/analytics/logs/email-logs)
- [ACS email status table](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/acsemailstatusupdateoperational)
- [Azure resource-context log queries](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries)
- [Azure Monitor workspace access modes](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/manage-access)
