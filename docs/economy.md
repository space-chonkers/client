# Economía (client)

La economía del equipo, del lado del client. El **server es autoritativo**: el client solo
muestra lo que recibe y envía intenciones. No calcula nada que cuente para el juego.

## Cómo funciona

```
Stash (uno solo, compartido por todo el equipo)
  food / water / energy / oxygen  →  se generan solos hasta un tope
        │
        │  cualquier jugador interactúa con la sección de un producto
        ▼  conversión automática a dinero (tasa por recurso)
Pool (dinero del equipo)
        │
        ▼  mantenimiento de la base: casillas construidas × costo por casilla, cada segundo
```

- **Stash:** un slot por recurso. Cada uno produce `productionPerSecond` hasta `capacity`.
  No es de ningún jugador: cualquiera puede recolectar.
- **Recolectar:** convierte las unidades enteras de un recurso en dinero y lo suma a la Pool.
- **Valor de cada recurso:**
  `oxygen > water > food > energy` (mock: 8 · 5 · 3 · 2).
- **Pool:** solo guarda dinero.
- **Mantenimiento:** `baseTiles × upkeepPerTilePerSecond`. Expandir la base cuesta más
  por segundo, así que el equipo tiene que recolectar más para sostenerla.

## Contrato con el server

Definido en [`src/economy/types.ts`](../src/economy/types.ts). Son objetos planos en JSON
sobre WebSocket.

| Dirección       | Mensaje            | Cuándo                                                                                              |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| server → client | `economy.snapshot` | Cada tick y después de cada cambio. Trae `stash`, `pool` y `conversionRates`.                       |
| server → client | `stash.collected`  | Después de una recolección exitosa (`resource`, `units`, `money`). Sirve para avisos o animaciones. |
| server → client | `economy.rejected` | Una intención no se pudo aplicar (`reason`).                                                        |
| client → server | `stash.collect`    | Un jugador interactuó con la sección de un recurso (`resource`).                                    |

El client ignora snapshots con un `tick` menor al último que recibió (llegaron fuera de orden).

## Archivos

| Archivo                         | Qué hace                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/economy/types.ts`          | Contrato: tipos de estado y mensajes.                                                                                                                                                                                                              |
| `src/economy/rules.ts`          | Reglas de referencia como funciones puras (`produce`, `collect`, `applyUpkeep`, `upkeepPerSecond`, `secondsUntilBroke`). La implementación real vive en el server; aquí las usa el mock y sirven de documentación ejecutable para el equipo de Go. |
| `src/economy/EconomyStore.ts`   | Espejo del estado del server en el client. TypeScript puro, sin React ni Three.js.                                                                                                                                                                 |
| `src/economy/useEconomy.ts`     | Hook de React (`useSyncExternalStore`) para leer el store.                                                                                                                                                                                         |
| `src/net/transport.ts`          | Interfaz `GameTransport` y `createTransport()`, que elige entre WebSocket y mock.                                                                                                                                                                  |
| `src/net/websocketTransport.ts` | Conexión al gateway de Go con reconexión exponencial (1 s → 10 s máx.). Las intenciones enviadas sin conexión se descartan.                                                                                                                        |
| `src/net/mockTransport.ts`      | Server falso para desarrollo y tests, con valores placeholder.                                                                                                                                                                                     |
| `src/ui/EconomyHUD.tsx`         | HUD sobre la escena: dinero, mantenimiento, aviso "⚠ Low" y el Stash.                                                                                                                                                                              |
| `src/economy/economy.test.ts`   | Tests de reglas e integración (mock → transporte → store).                                                                                                                                                                                         |

## Cómo integrarlo

**Interacción del personaje:** cuando el jugador interactúa con la sección de un recurso:

```ts
economy.collect("oxygen");
```

Después hay que borrar el botón **Collect** del HUD, que solo existe para pruebas.

**Leer el estado desde un componente:**

```tsx
const { pool, stash } = useEconomy(economy);
```

**Íconos:** los placeholders (`F`, `W`, `E`, `O`) están en `RESOURCE_META`, dentro de
`src/ui/EconomyHUD.tsx`.

## Correr y probar

```sh
cp .env.example .env     # opcional
bun run dev              # sin VITE_SERVER_URL usa el mock
bun test
```

| Variable          | Uso                                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| `VITE_SERVER_URL` | URL WebSocket del gateway, p. ej. `ws://localhost:8081/ws`. Vacía = mock. |
| `VITE_USE_MOCK`   | `true` fuerza el mock aunque haya URL.                                    |

**Prueba visual con el mock:** la Pool empieza en 200 y baja 4/s (4 casillas × 1). Cada recurso
del Stash sube 2/s hasta 50. Con **Collect** el dinero sube según la tasa del recurso.
A los ~20 s sin recolectar aparece "⚠ Low" (menos de 30 s para quedarse sin dinero).
