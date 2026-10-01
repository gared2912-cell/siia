// Acceso directo a las tablas de Amplify Data desde las Lambdas.
// Los registros incluyen __typename/createdAt/updatedAt para que AppSync los lea igual que los propios.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID, randomInt } from 'node:crypto';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export type Item = Record<string, any>;

export const table = (model: string) => {
  const name = process.env[`TABLE_${model}`];
  if (!name) throw new Error(`Tabla no configurada: ${model}`);
  return name;
};

export const now = () => new Date().toISOString();

export async function get(model: string, key: Item): Promise<Item | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: table(model), Key: key }));
  return r.Item;
}

export async function put(model: string, item: Item, opts: { ifNotExists?: string } = {}): Promise<Item> {
  const ts = now();
  // Perfil usa userId como llave; el resto de los modelos usa id.
  const base = model === 'Perfil' ? {} : { id: randomUUID() };
  const full = { ...base, createdAt: ts, ...item, updatedAt: ts, __typename: model };
  await ddb.send(
    new PutCommand({
      TableName: table(model),
      Item: full,
      ...(opts.ifNotExists ? { ConditionExpression: `attribute_not_exists(${opts.ifNotExists})` } : {}),
    }),
  );
  return full;
}

export async function update(model: string, key: Item, fields: Item): Promise<Item> {
  const set = { ...fields, updatedAt: now() };
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};
  const parts: string[] = [];
  Object.entries(set).forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    parts.push(`#f${i} = :v${i}`);
  });
  const keyName = Object.keys(key)[0];
  const r = await ddb.send(
    new UpdateCommand({
      TableName: table(model),
      Key: key,
      UpdateExpression: `SET ${parts.join(', ')}`,
      ExpressionAttributeNames: { ...names, '#pk': keyName },
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(#pk)',
      ReturnValues: 'ALL_NEW',
    }),
  );
  return r.Attributes as Item;
}

export async function remove(model: string, key: Item) {
  await ddb.send(new DeleteCommand({ TableName: table(model), Key: key }));
}

/** Consulta un índice secundario (todos los índices se llaman by<Campo>). */
export async function byIndex(model: string, index: string, field: string, value: string): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table(model),
        IndexName: index,
        KeyConditionExpression: '#k = :v',
        ExpressionAttributeNames: { '#k': field },
        ExpressionAttributeValues: { ':v': value },
        ExclusiveStartKey,
      }),
    );
    items.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export const newest = (a: Item, b: Item) => String(b.createdAt).localeCompare(String(a.createdAt));

/** Fecha (AAAA-MM-DD) en la zona horaria de México. */
export function hoyMX(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d);
}

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function codigoCorto(n = 8): string {
  let s = '';
  for (let i = 0; i < n; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

export class ApiError extends Error {}
export const fail = (msg: string): never => {
  throw new ApiError(msg);
};

export function parsePayload(p: unknown): Item {
  if (p == null) return {};
  if (typeof p === 'string') {
    try {
      return JSON.parse(p) ?? {};
    } catch {
      return {};
    }
  }
  return p as Item;
}

export const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const MODULOS = [
  'finanzas',
  'visitas',
  'comunicados',
  'encuestas',
  'chat',
  'incidentes',
  'mantenimientos',
  'amenidades',
  'mascotas',
] as const;

export async function scan(model: string): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: table(model), ExclusiveStartKey }));
    items.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}
