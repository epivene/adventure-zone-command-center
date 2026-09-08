export function isContractBuilderEnabled(value = process.env.CONTRACT_BUILDER_ENABLED) {
  return value === "true";
}
