/**
 * The eval harness shares the application's model transport rather than
 * carrying its own, so a provider added for the product is immediately
 * available to the benchmark and cannot drift from it.
 */
export * from "@/lib/model/client";
