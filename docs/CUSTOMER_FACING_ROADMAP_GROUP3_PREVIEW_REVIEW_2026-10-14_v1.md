# Group 3: document preview quality, first format review

Date: 2026-10-14 PDT
Status: Implementation candidate. Production verification is pending release.

## Live format evidence

Read-only checks used existing files in the CloudVault Series A demo room. No files were uploaded, changed, or removed. The findings describe representative files, not an exhaustive certification of every format or browser.

| Format   | Observed live behavior                                                                            | Conclusion                                                           |
| -------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| PDF      | Opened in the browser PDF viewer with its page controls.                                          | Usable in the tested Chrome session.                                 |
| DOCX     | A converted page opened and its text was readable.                                                | Conversion works for the sampled file.                               |
| XLSX     | A converted page opened and its table was readable.                                               | Conversion works for the sampled file.                               |
| PPTX     | A converted slide opened at its natural image width and the right side was clipped by the dialog. | Confirmed viewer defect.                                             |
| Markdown | Rendered headings, tables, and text.                                                              | Usable in the tested Chrome session.                                 |
| HTML     | Displayed as source text rather than executing as a page.                                         | Safe source preview; rich HTML rendering was not tested or promised. |

The repository already includes Gotenberg conversion, rasterized page assets, and a text renderer. The first change therefore targets the confirmed viewer defect. Other formats, large files, multi-page conversions, mobile browsers, and conversion-failure rates remain unmeasured.

## Implementation contract

Converted image page responses render as images that fit the preview width and preserve aspect ratio. Tall pages may scroll vertically. PDF responses retain the iframe viewer. The page count and Previous/Next controls remain available for multi-page converted files. A failed converted-preview request gives a truthful message, Retry preview, and Download Instead.

## Review

**Strawman:** Increase the iframe width or add horizontal scrolling. This still makes wide slides hard to use on smaller screens and does not fix the misleading failure message.

**Steelman:** Use the response MIME type to render generated image pages as responsive images and preserve the PDF iframe path. Keep the existing page API, navigation, and blob lifecycle. Give transient fetch failures a retry path.

**Premortem:** A response mislabeled as an image may fail to decode; the server's content type and existing conversion tests must remain reliable. Very tall pages can need vertical scrolling, so the image container remains scrollable. A page change must not display the prior page while the next image loads. A failed request must not leave the dialog stuck without a retry. This change does not address conversion fidelity or formats absent from the live sample.

## Verification

- Red-first component tests reproduced the iframe rendering of converted PNG pages and the inaccurate error fallback.
- Focused tests cover image fit, multi-page navigation, PDF iframe fallback, and retry after a temporary failure.
- Type check passed. Full test, lint, build, CI, and staging checks remain release gates.

## Sources

- `docs/CUSTOMER_FACING_ROADMAP_GROUPS_AND_GROUP1_PLAN_2026-10-14_v3.md`
- `src/app/(admin)/rooms/[roomId]/_components/PreviewDialog.tsx`
- `src/app/(admin)/rooms/[roomId]/_components/PreviewDialog.test.tsx`
- `src/app/api/rooms/[roomId]/documents/[documentId]/preview/route.ts`
- `src/providers/preview/GotenbergPreviewProvider.ts`
