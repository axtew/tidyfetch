/** The request as it was sent: carried by errors. */
export interface HttpRequest {
  /** Upper-cased method. */
  method: string;
  /** The URL passed to `fetch`, with the query. */
  url: string;
  /** Client and request headers merged. */
  headers: Headers;
}
