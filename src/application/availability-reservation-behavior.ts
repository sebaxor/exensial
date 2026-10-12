import type { EntityBehaviorModule } from "./entity-behaviors";
import { type EntityOperationContext, ValidationError } from "./entity-runtime";

type ReservationConfiguration = {
  resource: {
    entityName: string;
    namespace?: string;
    referenceField: string;
    availabilityField: string;
  };
  loan: {
    statusField: string;
    activeValue: string;
    returnedValue: string;
    returnedAtField: string;
    requiredFields: string[];
    isoDateFields: string[];
    dateRange: { startField: string; endField: string };
  };
};

/** A reusable, declaratively configured workflow for reserving and releasing an available resource. */
export const availabilityReservationBehavior: EntityBehaviorModule = {
  id: "exensial/availability-reservation",
  validateConfiguration(configuration) { configurationFor(configuration); },
  operations: {
    create: async (context, next) => {
      const configuration = configurationFor(context.definition.context?.behavior);
      const input = oneInput(context.input);
      validateCreateInput(input, configuration);
      const resource = referencedResource(context, input, configuration);
      if (resource[configuration.resource.availabilityField] !== true) {
        throw new ValidationError("Referenced resource is not available");
      }

      input[configuration.loan.statusField] = configuration.loan.activeValue;
      await setAvailability(context, resource.id, configuration, false);
      try {
        await next();
      } catch (error) {
        await setAvailability(context, resource.id, configuration, true);
        throw error;
      }
    },
    bulkCreate: async () => {
      throw new ValidationError("Bulk reservations are not supported because each resource must be reserved atomically");
    },
    update: returnResource,
    replace: returnResource,
    delete: async (context, next) => {
      const configuration = configurationFor(context.definition.context?.behavior);
      if (context.current?.[configuration.loan.statusField] === configuration.loan.activeValue) {
        throw new ValidationError("Active reservations cannot be deleted; return the resource first");
      }
      await next();
    }
  }
};

async function returnResource(context: EntityOperationContext, next: () => Promise<void>): Promise<void> {
  const configuration = configurationFor(context.definition.context?.behavior);
  const input = oneInput(context.input);
  const statusField = configuration.loan.statusField;
  if (!(statusField in input)) return next();
  if (input[statusField] !== configuration.loan.returnedValue) {
    throw new ValidationError(`Only ${configuration.loan.returnedValue} is accepted when changing ${statusField}`);
  }
  if (context.current?.[statusField] !== configuration.loan.activeValue) {
    throw new ValidationError("Only active reservations can be returned");
  }
  validateNonEmptyString(input[configuration.loan.returnedAtField], configuration.loan.returnedAtField);
  validateIsoDate(input[configuration.loan.returnedAtField], configuration.loan.returnedAtField);
  const resource = referencedResource(context, context.current, configuration);
  await next();
  await setAvailability(context, resource.id, configuration, true);
}

function configurationFor(value: unknown): ReservationConfiguration {
  if (!isObject(value) || !isObject(value.resource) || !isObject(value.loan)) {
    throw new ValidationError("Availability reservation behavior requires resource and loan configuration");
  }
  const resource = value.resource;
  const loan = value.loan;
  for (const key of ["entityName", "referenceField", "availabilityField"]) validateNonEmptyString(resource[key], `resource.${key}`);
  if (resource.namespace !== undefined) validateNonEmptyString(resource.namespace, "resource.namespace");
  for (const key of ["statusField", "activeValue", "returnedValue", "returnedAtField"]) validateNonEmptyString(loan[key], `loan.${key}`);
  if (!stringArray(loan.requiredFields) || !stringArray(loan.isoDateFields) || !isObject(loan.dateRange)) {
    throw new ValidationError("Loan configuration requires requiredFields, isoDateFields, and dateRange");
  }
  validateNonEmptyString(loan.dateRange.startField, "loan.dateRange.startField");
  validateNonEmptyString(loan.dateRange.endField, "loan.dateRange.endField");
  return value as ReservationConfiguration;
}

function validateCreateInput(input: Record<string, unknown>, configuration: ReservationConfiguration): void {
  for (const field of configuration.loan.requiredFields) validateNonEmptyString(input[field], field);
  for (const field of configuration.loan.isoDateFields) {
    if (field in input) validateIsoDate(input[field], field);
  }
  const { startField, endField } = configuration.loan.dateRange;
  if (new Date(String(input[endField])).getTime() <= new Date(String(input[startField])).getTime()) {
    throw new ValidationError(`${endField} must be after ${startField}`);
  }
  if (configuration.loan.returnedAtField in input) throw new ValidationError("New reservations cannot include a return timestamp");
  if (configuration.loan.statusField in input) throw new ValidationError("Reservation status is assigned by the workflow");
}

function referencedResource(
  context: Pick<EntityOperationContext, "runtime">,
  source: Record<string, unknown> | undefined,
  configuration: ReservationConfiguration
): { id: string; [key: string]: unknown } {
  const id = source?.[configuration.resource.referenceField];
  validateNonEmptyString(id, configuration.resource.referenceField);
  const resource = context.runtime.findRecord(configuration.resource.entityName, id as string, configuration.resource.namespace);
  if (!resource) throw new ValidationError("Referenced resource does not exist");
  return resource;
}

async function setAvailability(
  context: Pick<EntityOperationContext, "runtime" | "request">,
  resourceId: string,
  configuration: ReservationConfiguration,
  available: boolean
): Promise<void> {
  await context.runtime.execute({
    apiVersion: context.request.apiVersion,
    namespace: configuration.resource.namespace,
    entityName: configuration.resource.entityName,
    action: "update",
    id: resourceId,
    payload: { kind: "one", value: { [configuration.resource.availabilityField]: available } }
  });
}

function oneInput(input: unknown): Record<string, unknown> {
  if (!input || Array.isArray(input)) throw new ValidationError("Expected one reservation input object");
  return input as Record<string, unknown>;
}

function validateNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${field} must be a non-empty string`);
}

function validateIsoDate(value: unknown, field: string): void {
  validateNonEmptyString(value, field);
  if (!Number.isFinite(Date.parse(String(value)))) throw new ValidationError(`${field} must be an ISO-8601 date-time`);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
