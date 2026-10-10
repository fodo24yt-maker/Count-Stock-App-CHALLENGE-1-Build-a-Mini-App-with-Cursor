import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const STORAGE_KEY = '@count-stock/items';

const FILTERS = [
  { id: 'added', label: 'Añadidos', hint: 'Últimos agregados primero.' },
  { id: 'alpha', label: 'Alfabético', hint: 'De la A a la Z.' },
  {
    id: 'closest',
    label: 'Cerca del mínimo',
    hint: 'Los que todavía no llegan, del más cercano al más lejos.',
  },
  {
    id: 'low',
    label: 'Stock bajo',
    hint: 'Los que ya llegaron al mínimo o lo pasaron.',
  },
];

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isStoredItem(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    Number.isInteger(value.quantity) &&
    value.quantity >= 0 &&
    Number.isInteger(value.minimum) &&
    value.minimum >= 0
  );
}

function parseCount(value) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number)) return null;
  return number;
}

function isLowStock(item) {
  return item.quantity <= item.minimum;
}

function stockGap(item) {
  return item.quantity - item.minimum;
}

function normalize(value) {
  return value
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function warningText(lowItems) {
  if (lowItems.length === 1) {
    return `${lowItems[0].name} está en o por debajo del mínimo.`;
  }
  if (lowItems.length === 2) {
    return `${lowItems[0].name} y ${lowItems[1].name} están en o por debajo del mínimo.`;
  }
  return `${lowItems.length} artículos están en o por debajo del mínimo.`;
}

function selectItems(items, filter, query) {
  const normalizedQuery = normalize(query);
  let list = items;
  if (normalizedQuery) {
    list = list.filter((item) => normalize(item.name).includes(normalizedQuery));
  }

  if (filter === 'low') {
    return list.filter(isLowStock).sort((a, b) => stockGap(a) - stockGap(b));
  }
  if (filter === 'closest') {
    return list
      .filter((item) => item.quantity > item.minimum)
      .sort((a, b) => stockGap(a) - stockGap(b));
  }
  if (filter === 'alpha') {
    return [...list].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    );
  }
  return list;
}

function emptyMessage(hasItems, filter, query) {
  if (!hasItems) {
    return 'Todavía no hay artículos. Tocá + para agregar el primero.';
  }
  if (normalize(query)) {
    return 'Ningún artículo coincide con la búsqueda.';
  }
  if (filter === 'low') {
    return 'Ningún artículo está en o por debajo del mínimo.';
  }
  if (filter === 'closest') {
    return 'No hay artículos por encima del mínimo.';
  }
  return 'Ningún artículo para mostrar.';
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StockScreen />
    </SafeAreaProvider>
  );
}

function StockScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [canPersist, setCanPersist] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('added');
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [minimum, setMinimum] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            throw new Error('El inventario guardado no es una lista.');
          }
          setItems(parsed.filter(isStoredItem));
        }
        setCanPersist(true);
      } catch {
        if (active) {
          setStorageError('No se pudo leer el inventario guardado.');
        }
      } finally {
        if (active) setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!canPersist) return;

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)).then(
      () => setStorageError(''),
      () => setStorageError('No se pudo guardar el inventario.'),
    );
  }, [items, canPersist]);

  const lowItems = useMemo(() => items.filter(isLowStock), [items]);
  const visibleItems = useMemo(
    () => selectItems(items, filter, query),
    [filter, items, query],
  );
  const activeFilter = FILTERS.find((option) => option.id === filter);

  const closeForm = useCallback(() => {
    setEditingId(null);
    setName('');
    setQuantity('');
    setMinimum('');
    setFormError('');
  }, []);

  const openCreate = useCallback(() => {
    setName('');
    setQuantity('');
    setMinimum('');
    setFormError('');
    setEditingId('new');
  }, []);

  const openEdit = useCallback((item) => {
    setName(item.name);
    setQuantity(String(item.quantity));
    setMinimum(String(item.minimum));
    setFormError('');
    setEditingId(item.id);
  }, []);

  const saveItem = useCallback(() => {
    const trimmedName = name.trim();
    const parsedQuantity = parseCount(quantity);
    const parsedMinimum = parseCount(minimum);

    if (!trimmedName) {
      setFormError('Ingresá el nombre del artículo.');
      return;
    }
    if (parsedQuantity === null) {
      setFormError('La cantidad tiene que ser un número entero de 0 o más.');
      return;
    }
    if (parsedMinimum === null) {
      setFormError('El mínimo tiene que ser un número entero de 0 o más.');
      return;
    }

    if (editingId === 'new') {
      setItems((current) => [
        {
          id: createId(),
          name: trimmedName,
          quantity: parsedQuantity,
          minimum: parsedMinimum,
        },
        ...current,
      ]);
    } else {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== editingId) return item;
          return {
            ...item,
            name: trimmedName,
            quantity: parsedQuantity,
            minimum: parsedMinimum,
          };
        }),
      );
    }
    closeForm();
  }, [closeForm, editingId, minimum, name, quantity]);

  const changeQuantity = useCallback((id, delta) => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        return { ...item, quantity: Math.max(0, item.quantity + delta) };
      }),
    );
  }, []);

  const removeItem = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Inventario</Text>
          <Text style={styles.title}>Control de stock</Text>
        </View>

        {storageError ? (
          <View style={styles.storageBanner}>
            <Text style={styles.storageBannerText}>{storageError}</Text>
          </View>
        ) : null}

        {ready && lowItems.length > 0 ? (
          <View style={styles.alert} accessibilityRole="alert">
            <Text style={styles.alertTitle}>Aviso de stock bajo</Text>
            <Text style={styles.alertBody}>{warningText(lowItems)}</Text>
          </View>
        ) : null}

        {ready ? (
          <>
            <View style={styles.searchBox}>
              <Magnifier />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar artículo"
                placeholderTextColor="#A8A29E"
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                accessibilityLabel="Buscar artículo"
                returnKeyType="search"
              />
              {query ? (
                <Pressable
                  onPress={() => setQuery('')}
                  style={styles.clearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Borrar búsqueda"
                >
                  <Text style={styles.clearSearchLabel}>×</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.filters}>
              {FILTERS.map((option) => {
                const selected = option.id === filter;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setFilter(option.id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                  >
                    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.filterHint}>{activeFilter.hint}</Text>

            <FlatList
              data={visibleItems}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + 96 },
              ]}
              ListHeaderComponent={
                <Text style={styles.sectionTitle}>
                  {normalize(query)
                    ? `Resultados (${visibleItems.length})`
                    : `Artículos (${visibleItems.length})`}
                </Text>
              }
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {emptyMessage(items.length > 0, filter, query)}
                </Text>
              }
              renderItem={({ item }) => (
                <StockRow
                  item={item}
                  showGap={filter === 'closest'}
                  onEdit={() => openEdit(item)}
                  onDecrease={() => changeQuantity(item.id, -1)}
                  onIncrease={() => changeQuantity(item.id, 1)}
                  onRemove={() => removeItem(item.id)}
                />
              )}
            />

            <Pressable
              onPress={openCreate}
              style={[styles.fab, { bottom: insets.bottom + 16 }]}
              accessibilityRole="button"
              accessibilityLabel="Agregar artículo"
            >
              <Text style={styles.fabLabel}>+</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Cargando inventario…</Text>
          </View>
        )}
      </View>

      <Modal
        visible={editingId !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={closeForm}
      >
        <SafeAreaProvider>
          <AddItemForm
            title={editingId === 'new' ? 'Nuevo artículo' : 'Editar artículo'}
            submitLabel={editingId === 'new' ? 'Agregar artículo' : 'Guardar cambios'}
            name={name}
            quantity={quantity}
            minimum={minimum}
            formError={formError}
            onChangeName={(value) => {
              setName(value);
              setFormError('');
            }}
            onChangeQuantity={(value) => {
              setQuantity(value);
              setFormError('');
            }}
            onChangeMinimum={(value) => {
              setMinimum(value);
              setFormError('');
            }}
            onClose={closeForm}
            onSubmit={saveItem}
          />
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

function AddItemForm({
  title,
  submitLabel,
  name,
  quantity,
  minimum,
  formError,
  onChangeName,
  onChangeQuantity,
  onChangeMinimum,
  onClose,
  onSubmit,
}) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.column}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.formTitle}>{title}</Text>
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
          >
            <Text style={styles.closeLabel}>Cerrar</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[
            styles.formContent,
            { paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.form}>
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              value={name}
              onChangeText={onChangeName}
              placeholder="Ej. Arroz"
              placeholderTextColor="#A8A29E"
              style={styles.input}
              autoCapitalize="sentences"
              autoFocus
              returnKeyType="next"
              accessibilityLabel="Nombre del artículo"
            />
            <View style={styles.row}>
              <View style={styles.field}>
                <Text style={styles.label}>Cantidad actual</Text>
                <TextInput
                  value={quantity}
                  onChangeText={onChangeQuantity}
                  placeholder="0"
                  placeholderTextColor="#A8A29E"
                  style={styles.input}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  selectTextOnFocus
                  accessibilityLabel="Cantidad actual"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Mínimo de alerta</Text>
                <TextInput
                  value={minimum}
                  onChangeText={onChangeMinimum}
                  placeholder="5"
                  placeholderTextColor="#A8A29E"
                  style={styles.input}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  selectTextOnFocus
                  accessibilityLabel="Mínimo de alerta"
                />
              </View>
            </View>
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <Pressable
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.addButton,
                pressed && styles.addButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
            >
              <Text style={styles.addButtonText}>{submitLabel}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Magnifier() {
  return (
    <View style={styles.magnifier} accessibilityElementsHidden importantForAccessibility="no">
      <View style={styles.magnifierRing} />
      <View style={styles.magnifierHandle} />
    </View>
  );
}

function StockRow({ item, showGap, onEdit, onDecrease, onIncrease, onRemove }) {
  const low = isLowStock(item);
  const gap = stockGap(item);

  return (
    <View style={[styles.card, low && styles.cardLow]}>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Editar ${item.name}`}
        style={({ pressed }) => [styles.editArea, pressed && styles.editAreaPressed]}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.itemName, low && styles.itemNameLow]}>{item.name}</Text>
          {low ? <Text style={styles.badge}>Stock bajo</Text> : null}
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, low && styles.metaLow]}>
            Cantidad {item.quantity} · Mínimo {item.minimum}
          </Text>
          <Text style={styles.editHint}>Editar</Text>
        </View>
      </Pressable>
      {showGap ? (
        <Text style={styles.gapText}>
          {gap === 1 ? 'Le falta 1 para el mínimo' : `Le faltan ${gap} para el mínimo`}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onDecrease}
          disabled={item.quantity === 0}
          style={({ pressed }) => [
            styles.stepButton,
            low && styles.stepButtonLow,
            item.quantity === 0 && styles.stepButtonDisabled,
            pressed && item.quantity > 0 && styles.stepButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Disminuir cantidad de ${item.name}`}
          accessibilityState={{ disabled: item.quantity === 0 }}
        >
          <Text style={[styles.stepLabel, low && styles.stepLabelLow]}>−</Text>
        </Pressable>
        <Text style={[styles.quantity, low && styles.quantityLow]}>{item.quantity}</Text>
        <Pressable
          onPress={onIncrease}
          style={({ pressed }) => [
            styles.stepButton,
            low && styles.stepButtonLow,
            pressed && styles.stepButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Aumentar cantidad de ${item.name}`}
        >
          <Text style={[styles.stepLabel, low && styles.stepLabelLow]}>+</Text>
        </Pressable>
        <Pressable
          onPress={onRemove}
          style={styles.removeButton}
          accessibilityRole="button"
          accessibilityLabel={`Quitar ${item.name}`}
        >
          <Text style={styles.removeLabel}>Quitar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F0E8',
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  kicker: {
    color: '#0F766E',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 2,
    color: '#1C1917',
    fontSize: 30,
    fontWeight: '700',
  },
  alert: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  alertTitle: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '700',
  },
  alertBody: {
    marginTop: 2,
    color: '#B91C1C',
    fontSize: 14,
    lineHeight: 20,
  },
  storageBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
  },
  storageBannerText: {
    color: '#92400E',
    fontSize: 14,
  },
  searchBox: {
    marginHorizontal: 20,
    marginBottom: 12,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  magnifier: {
    width: 18,
    height: 18,
    marginRight: 8,
  },
  magnifierRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#57534E',
  },
  magnifierHandle: {
    position: 'absolute',
    width: 7,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#57534E',
    right: 0,
    bottom: 2,
    transform: [{ rotate: '45deg' }],
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1C1917',
    paddingVertical: 10,
  },
  clearSearch: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearSearchLabel: {
    color: '#78716C',
    fontSize: 22,
    lineHeight: 24,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D6D3D1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: '#0F766E',
    borderColor: '#0F766E',
  },
  chipLabel: {
    color: '#44403C',
    fontSize: 14,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: '#FFFFFF',
  },
  filterHint: {
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 20,
    color: '#78716C',
    fontSize: 13,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#57534E',
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 10,
    color: '#1C1917',
    fontSize: 18,
    fontWeight: '700',
  },
  empty: {
    color: '#78716C',
    fontSize: 15,
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#0F766E',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  fabLabel: {
    color: '#FFFFFF',
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '500',
    marginTop: -2,
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  closeLabel: {
    color: '#0F766E',
    fontSize: 16,
    fontWeight: '700',
  },
  formContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  formTitle: {
    color: '#1C1917',
    fontSize: 22,
    fontWeight: '700',
  },
  label: {
    color: '#57534E',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FAFAF9',
    borderWidth: 1,
    borderColor: '#D6D3D1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1917',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  field: {
    flex: 1,
  },
  formError: {
    color: '#B91C1C',
    fontSize: 14,
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#0F766E',
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonPressed: {
    backgroundColor: '#115E59',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  cardLow: {
    backgroundColor: '#FEF2F2',
    borderColor: '#DC2626',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemName: {
    flex: 1,
    color: '#1C1917',
    fontSize: 17,
    fontWeight: '700',
  },
  itemNameLow: {
    color: '#991B1B',
  },
  badge: {
    color: '#FFFFFF',
    backgroundColor: '#DC2626',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
  },
  editArea: {
    borderRadius: 10,
  },
  editAreaPressed: {
    opacity: 0.65,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  meta: {
    flex: 1,
    color: '#57534E',
    fontSize: 14,
  },
  editHint: {
    color: '#0F766E',
    fontSize: 13,
    fontWeight: '700',
  },
  metaLow: {
    color: '#B91C1C',
  },
  gapText: {
    marginTop: 4,
    color: '#0F766E',
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonLow: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FECACA',
  },
  stepButtonPressed: {
    opacity: 0.7,
  },
  stepButtonDisabled: {
    opacity: 0.35,
  },
  stepLabel: {
    color: '#0F766E',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
  },
  stepLabelLow: {
    color: '#B91C1C',
  },
  quantity: {
    minWidth: 40,
    textAlign: 'center',
    color: '#1C1917',
    fontSize: 20,
    fontWeight: '700',
  },
  quantityLow: {
    color: '#991B1B',
  },
  removeButton: {
    marginLeft: 'auto',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  removeLabel: {
    color: '#78716C',
    fontSize: 15,
    fontWeight: '600',
  },
});
