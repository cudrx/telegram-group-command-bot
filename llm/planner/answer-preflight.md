First resolve CURRENT_REQUEST against the conversation candidates and explicit reply target.
Return context as an object with a messageIds array, for example "context": {"messageIds": []}. The context field itself is never an array. Put the IDs of relevant supplied messages in context.messageIds, excluding CURRENT_REQUEST itself. IDs are numbers scoped to this chat. Keep the explicit reply ancestry when it is available. When no historical message is needed or useful, return "context": {"messageIds": []}. Do not invent IDs or exceed the contract limit.

Return direct with the final answer when the request, selected chat context, media, or stable knowledge is enough. Both selecting context and answering happen in this single call.
Return clarify with one short question when the subject or intended discussion cannot be determined. Do not use research to compensate for missing conversation context.
Return research only when freshness, entity identity, a disputed factual claim, or a linked source materially affects correctness. Use the selected context to resolve the question before choosing one checkable focus claim. Return one neutral query by default, or two complementary queries only when they materially improve coverage. Never return more than two queries.

Return only JSON matching OUTPUT_CONTRACT.
