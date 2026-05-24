'use client';

import React, { useState, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  Package,
  Warehouse,
  Timer,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Zap,
  Plus,
  Trash2,
  ShieldAlert,
  DollarSign,
  Database,
  Copy,
  Lock,
  Moon,
  Sun,
  Layers,
  Sparkles,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

// SWR Fetcher
const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Interface Declarations
interface StockBreakdown {
  warehouseId: string;
  warehouseName: string;
  location: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  stockBreakdown: StockBreakdown[];
}

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
  idempotencyKey: string | null;
  product: { name: string; sku: string };
  warehouse: { name: string; location: string };
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

interface BattleLog {
  id: string;
  timestamp: string;
  user: string;
  status: 'success' | 'conflict' | 'pending';
  code: number;
  message: string;
}

// Live Countdown Timer Component
const CountdownTimer: React.FC<{
  expiresAt: string;
  createdAt: string;
  status: string;
  onExpire: () => void;
}> = ({ expiresAt, createdAt, status, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [progress, setProgress] = useState<number>(100);
  const hasExpiredRef = useRef(false);

  useEffect(() => {
    const calculateTime = () => {
      const expiry = new Date(expiresAt).getTime();
      const created = new Date(createdAt).getTime();
      const now = new Date().getTime();
      
      const totalDuration = expiry - created;
      const remaining = expiry - now;

      if (remaining <= 0) {
        setTimeLeft(0);
        setProgress(0);
        if (!hasExpiredRef.current && status === 'PENDING') {
          hasExpiredRef.current = true;
          onExpire();
        }
        return;
      }

      setTimeLeft(remaining);
      const computedProgress = (remaining / totalDuration) * 100;
      setProgress(Math.max(0, Math.min(100, computedProgress)));
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, createdAt, status, onExpire]);

  if (status !== 'PENDING') return null;

  const minutes = Math.floor(timeLeft / 1000 / 60);
  const seconds = Math.floor((timeLeft / 1000) % 60);
  const isUrgent = timeLeft < 60 * 1000; // < 1 minute

  return (
    <div className="w-full space-y-1.5 mt-2">
      <div className="flex justify-between items-center text-xs">
        <span className="flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
          <Timer className={`w-3.5 h-3.5 ${isUrgent ? 'text-red-500 animate-pulse' : 'text-indigo-500'}`} />
          Reservation Hold
        </span>
        <span className={`font-mono font-bold ${isUrgent ? 'text-red-500 animate-pulse' : 'text-indigo-500 dark:text-indigo-400'}`}>
          {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
        </span>
      </div>
      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-1000 rounded-full ${
            isUrgent 
              ? 'bg-gradient-to-r from-red-500 to-rose-600' 
              : 'bg-gradient-to-r from-indigo-500 to-violet-600'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export default function Dashboard() {
  const { mutate } = useSWRConfig();
  
  // Theme state (Dark Mode by default)
  const [isDarkMode, setIsDarkMode] = useState(true);

  // SWR Hooks for live data sync
  const { data: productsData, error: productsError, isLoading: productsLoading } = useSWR<{ products: Product[] }>(
    '/api/products',
    fetcher,
    { refreshInterval: 3000 } // Poll every 3 seconds for real-time stock
  );

  const { data: reservationsData, error: resError } = useSWR<{ reservations: Reservation[] }>(
    '/api/reservations',
    fetcher,
    { refreshInterval: 3000 } // Poll reservations as well
  );

  // Client states
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [reserveQuantity, setReserveQuantity] = useState<number>(1);
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Concurrency Simulation States
  const [isSimulating, setIsSimulating] = useState(false);
  const [battleLogs, setBattleLogs] = useState<BattleLog[]>([]);
  const [concurrencyTarget, setConcurrencyTarget] = useState<{ productId: string; warehouseId: string } | null>(null);

  // System Utility states
  const [isSeeding, setIsSeeding] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  // Trigger dark mode HTML class changes
  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Toast Helper
  const addToast = (type: Toast['type'], title: string, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Seed database
  const handleSeedDatabase = async () => {
    setIsSeeding(true);
    try {
      // We will call seed by fetching a simple endpoint we will define next
      // Or we can just seed via a simple API endpoint.
      // Wait, let's create a POST endpoint or call the trigger
      const res = await fetch('/api/cron/cleanup'); // trigger cleanup, but let's check seeding
      
      // Let's implement an endpoint `/api/seed` in the backend so user can seed!
      const seedRes = await fetch('/api/seed', { method: 'POST' });
      const data = await seedRes.json();
      
      if (seedRes.ok) {
        addToast('success', 'Database Seeded', 'Mock catalog and inventories populated successfully!');
        mutate('/api/products');
        mutate('/api/reservations');
      } else {
        addToast('error', 'Seeding Failed', data.error || 'Failed to seed database');
      }
    } catch (err) {
      addToast('error', 'Network Error', 'Could not execute seed API endpoint.');
    } finally {
      setIsSeeding(false);
    }
  };

  // Manual cron cleanup
  const handleCronCleanup = async () => {
    setIsCleaning(true);
    try {
      const res = await fetch('/api/cron/cleanup');
      const data = await res.json();
      if (res.ok) {
        addToast('success', 'Maintenance Complete', 'All pending expired holds have been successfully returned to available stock!');
        mutate('/api/products');
        mutate('/api/reservations');
      } else {
        addToast('error', 'Cleanup Failed', data.error || 'Failed to complete cleanup');
      }
    } catch (err) {
      addToast('error', 'Network Error', 'Error triggering cleanup worker.');
    } finally {
      setIsCleaning(false);
    }
  };

  // Open reservation holding dialog
  const openReserveModal = (product: Product) => {
    setSelectedProduct(product);
    // Auto-select first warehouse that has available units
    const firstAvailable = product.stockBreakdown.find(inv => inv.availableUnits > 0);
    setSelectedWarehouseId(firstAvailable ? firstAvailable.warehouseId : product.stockBreakdown[0]?.warehouseId || '');
    setReserveQuantity(1);
    // Generate a unique standard idempotency key
    setCustomIdempotencyKey(`res_key_${Math.random().toString(36).substring(2, 9)}`);
    setIsCreateModalOpen(true);
  };

  // Create standard single reservation hold
  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !selectedWarehouseId) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': customIdempotencyKey || undefined,
        } as HeadersInit,
        body: JSON.stringify({
          productId: selectedProduct.id,
          warehouseId: selectedWarehouseId,
          quantity: reserveQuantity,
        }),
      });

      const data = await res.json();

      if (res.status === 201) {
        addToast('success', 'Stock Hold Created', `Successfully reserved ${reserveQuantity} units for 10 minutes.`);
        setIsCreateModalOpen(false);
        mutate('/api/products');
        mutate('/api/reservations');
      } else if (res.status === 409) {
        addToast('error', '409 Stock Conflict', data.error || 'Insufficient stock in the selected warehouse.');
      } else {
        addToast('error', `Error (${res.status})`, data.error || 'Failed to create reservation');
      }
    } catch (err) {
      addToast('error', 'Network Error', 'Failed to communicate with reservation engine.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Purchase (permanent deduction)
  const handleConfirmReservation = async (id: string) => {
    const idempotencyKey = `conf_key_${id.substring(0, 8)}_${Math.random().toString(36).substring(2, 5)}`;
    
    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: {
          'x-idempotency-key': idempotencyKey,
        },
      });

      const data = await res.json();

      if (res.status === 200) {
        addToast('success', 'Purchase Confirmed!', 'Payment succeeded. Stock permanently deducted.');
        mutate('/api/products');
        mutate('/api/reservations');
      } else if (res.status === 410) {
        addToast('warning', '410 Hold Expired', 'Hold expired during payment processing. Stock returned to pool.');
        mutate('/api/products');
        mutate('/api/reservations');
      } else {
        addToast('error', 'Confirmation Failed', data.error || 'Error confirming purchase');
      }
    } catch (err) {
      addToast('error', 'Network Error', 'Error sending confirmation request.');
    }
  };

  // Release hold early
  const handleReleaseReservation = async (id: string) => {
    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: 'POST',
      });

      const data = await res.json();

      if (res.status === 200) {
        addToast('info', 'Hold Released Early', 'Hold cancelled. Stock is immediately available.');
        mutate('/api/products');
        mutate('/api/reservations');
      } else {
        addToast('error', 'Release Failed', data.error || 'Error releasing hold');
      }
    } catch (err) {
      addToast('error', 'Network Error', 'Error sending release request.');
    }
  };

  // Automated concurrency test
  const handleTriggerConcurrencyTest = async (productId: string, warehouseId: string, totalAvailable: number) => {
    if (isSimulating) return;

    setConcurrencyTarget({ productId, warehouseId });
    setIsSimulating(true);
    setBattleLogs([]);

    addToast('info', 'Launching Concurrency Battle', `Firing 3 overlapping checkout requests for 1 available unit simultaneously...`);

    const logBattle = (user: string, status: BattleLog['status'], code: number, message: string) => {
      const newLog: BattleLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString([], { hour12: false, fractionalSecondDigits: 3 } as any),
        user,
        status,
        code,
        message,
      };
      setBattleLogs((prev) => [newLog, ...prev]);
    };

    // Shared idempotency keys (each user gets a unique one to simulate 3 distinct checkout browsers)
    const userKeys = [
      `battle_user_alpha_${Math.random().toString(36).substring(2, 6)}`,
      `battle_user_beta_${Math.random().toString(36).substring(2, 6)}`,
      `battle_user_gamma_${Math.random().toString(36).substring(2, 6)}`
    ];

    const users = ['User Alpha (Chrome)', 'User Beta (Firefox)', 'User Gamma (Mobile App)'];

    // 1. Prepare simultaneous requests
    const checkoutRequests = users.map((user, idx) => {
      return async () => {
        logBattle(user, 'pending', 0, 'Submitting checkout hold request...');
        try {
          const res = await fetch('/api/reservations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-idempotency-key': userKeys[idx],
            },
            body: JSON.stringify({
              productId,
              warehouseId,
              quantity: 1, // trying to reserve the last unit
            }),
          });
          const data = await res.json();

          if (res.status === 201) {
            logBattle(user, 'success', 201, `WINNER! Acquired PG Row-Lock. Reservation Hold: ${data.reservationId.substring(0, 8)}...`);
            addToast('success', 'Simulation Winner!', `${user} successfully secured the stock hold!`);
          } else if (res.status === 409) {
            logBattle(user, 'conflict', 409, `DENIED (409 Conflict): Row locked by transaction. Insufficient stock.`);
          } else {
            logBattle(user, 'conflict', res.status, `FAILED: ${data.error || 'Server error'}`);
          }
        } catch (err) {
          logBattle(user, 'conflict', 500, 'Network interruption during execution.');
        }
      };
    });

    // 2. Fire them in parallel (simulating microsecond concurrency overlap)
    await Promise.all(checkoutRequests.map(req => req()));

    setIsSimulating(false);
    mutate('/api/products');
    mutate('/api/reservations');
  };

  // Filter products by search term
  const filteredProducts = productsData?.products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="flex-1 w-full min-h-screen flex flex-col relative">
      
      {/* Toast Overlay */}
      <div className="fixed top-6 right-6 z-[9999] space-y-3 w-full max-w-md pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-lg border flex gap-3 items-start animate-in slide-in-from-right-5 duration-300 ${
              toast.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-900/50'
                : toast.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/90 text-rose-900 dark:text-rose-100 border-rose-200 dark:border-rose-900/50'
                : toast.type === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/90 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-900/50'
                : 'bg-indigo-50 dark:bg-indigo-950/90 text-indigo-900 dark:text-indigo-100 border-indigo-200 dark:border-indigo-900/50'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
            {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-500 shrink-0" />}
            {toast.type === 'warning' && <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
            {toast.type === 'info' && <Zap className="w-5 h-5 text-indigo-500 shrink-0" />}
            
            <div className="flex-1 space-y-1">
              <h4 className="font-semibold text-sm leading-tight">{toast.title}</h4>
              <p className="text-xs leading-normal opacity-90">{toast.message}</p>
            </div>
            
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Main SaaS Layout */}
      {/* Header */}
      <header className="glass sticky top-0 z-50 w-full py-4 px-6 md:px-12 flex justify-between items-center select-none shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl text-white shadow-md shadow-indigo-500/20">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight bg-gradient-to-r from-slate-900 to-indigo-950 dark:from-white dark:to-indigo-200 bg-clip-text text-transparent flex items-center gap-1.5">
              OmniStock <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">v15+</span>
            </h1>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Atomic Multi-Warehouse Hold System</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex gap-1 text-[11px] text-slate-500 font-mono items-center bg-slate-100 dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1"></span>
            Database Sync Active
          </div>

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all text-slate-600 dark:text-slate-300"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Hero Header Banner */}
      <section className="px-6 md:px-12 pt-8 pb-4">
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 md:p-8 text-white relative overflow-hidden shadow-xl border border-slate-800/80">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent"></div>
          <div className="relative z-10 space-y-4 max-w-3xl">
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full border border-indigo-500/30">
              <Sparkles className="w-3.5 h-3.5" /> High-Concurrency Commerce Locking
            </span>
            <h2 className="text-2xl md:text-4xl font-extrabold tracking-tight">
              Temporary Checkout Holds. <br />
              <span className="bg-gradient-to-r from-indigo-400 to-violet-200 bg-clip-text text-transparent">Zero Overselling. Guaranteed.</span>
            </h2>
            <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
              When a buyer enters checkout, stock is dynamically booked for 10 minutes. If payment completes, the stock is permanently deducted. If they abandon, stock is automatically returned. Powered by raw <code className="font-mono bg-slate-900/60 px-1 rounded border border-slate-700 text-indigo-300">SELECT FOR UPDATE</code> PostgreSQL row locks.
            </p>
          </div>
        </div>
      </section>

      {/* Quick Metrics Bar */}
      <section className="px-6 md:px-12 py-3 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border p-4 rounded-2xl shadow-sm space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Active Temporary Holds</p>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-bold font-mono text-indigo-500 dark:text-indigo-400">
              {reservationsData?.reservations.filter(r => r.status === 'PENDING').length || 0}
            </span>
            <Timer className="w-5 h-5 text-muted-foreground/60 mb-1" />
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-2xl shadow-sm space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Permanently Sold Units</p>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-bold font-mono text-emerald-500">
              {reservationsData?.reservations.filter(r => r.status === 'CONFIRMED').length || 0}
            </span>
            <CheckCircle2 className="w-5 h-5 text-muted-foreground/60 mb-1" />
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-2xl shadow-sm space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Out of Stock Warehouses</p>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-bold font-mono text-rose-500">
              {productsData?.products.reduce((acc, p) => 
                acc + p.stockBreakdown.filter(w => w.totalUnits === 0).length, 0
              ) || 0}
            </span>
            <AlertCircle className="w-5 h-5 text-muted-foreground/60 mb-1" />
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-2xl shadow-sm space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Total Catalog Products</p>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-bold font-mono">
              {productsData?.products.length || 0}
            </span>
            <Package className="w-5 h-5 text-muted-foreground/60 mb-1" />
          </div>
        </div>
      </section>

      {/* Main Grid Content */}
      <main className="flex-1 px-6 md:px-12 py-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Product Catalog & Concurrency battle log (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Catalog Search & Actions */}
          <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="font-bold text-lg">Product Stock Catalog</h3>
                <p className="text-xs text-muted-foreground">Monitor real-time warehouse distribution breakdown and holds</p>
              </div>

              <div className="flex flex-wrap gap-2 select-none">
                <button
                  onClick={handleSeedDatabase}
                  disabled={isSeeding}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Database className="w-3.5 h-3.5" />
                  {isSeeding ? 'Seeding...' : 'Seed Catalog'}
                </button>

                <button
                  onClick={handleCronCleanup}
                  disabled={isCleaning}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-border hover:bg-muted transition-colors disabled:opacity-50 text-slate-700 dark:text-slate-300"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCleaning ? 'animate-spin' : ''}`} />
                  Trigger Expiry Sweep
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Search products by title or SKU code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-border bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
              <Package className="w-4.5 h-4.5 absolute right-3 top-3 text-muted-foreground" />
            </div>
          </div>

          {/* Product Grid / Loader */}
          {productsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3].map((n) => (
                <div key={n} className="bg-card border border-border rounded-2xl p-6 space-y-4 animate-pulse">
                  <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-2/3"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3"></div>
                  <div className="space-y-2 pt-4">
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full"></div>
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-12 text-center space-y-4">
              <div className="w-12 h-12 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-md">No Products Loaded</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  The database seems empty or no items match your search. Use the "Seed Catalog" button above to quickly generate products, warehouses, and warehouse inventory holdings.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredProducts.map((product) => {
                const isOutOfStock = product.totalAvailable === 0;
                
                return (
                  <div
                    key={product.id}
                    className={`bg-card border rounded-2xl p-6 shadow-sm flex flex-col justify-between transition-all duration-300 ${
                      isOutOfStock 
                        ? 'border-rose-100 dark:border-rose-950/20 bg-rose-50/10 dark:bg-rose-950/5' 
                        : 'border-border hover:border-indigo-200 dark:hover:border-indigo-900/60'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                            {product.sku}
                          </span>
                          <h4 className="font-bold text-md text-slate-900 dark:text-white leading-tight mt-0.5">
                            {product.name}
                          </h4>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          isOutOfStock
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : product.totalAvailable <= 3
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                            : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {isOutOfStock ? 'Out of Stock' : product.totalAvailable <= 3 ? 'Low Stock' : 'In Stock'}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground leading-normal line-clamp-2">
                        {product.description}
                      </p>

                      {/* Stock Breakdown per Warehouse */}
                      <div className="pt-4 border-t border-border space-y-2.5">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Warehouse Breakdown</p>
                        <div className="space-y-2">
                          {product.stockBreakdown.map((inv) => (
                            <div
                              key={inv.warehouseId}
                              className="text-xs flex flex-col p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800"
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                  <Warehouse className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                  {inv.warehouseName}
                                </span>
                                <span className="font-mono text-slate-500 font-medium">
                                  {inv.availableUnits}/{inv.totalUnits} <span className="text-[10px] opacity-75">avail</span>
                                </span>
                              </div>
                              
                              {/* Progress mini indicator */}
                              <div className="w-full bg-slate-200 dark:bg-slate-800 h-1 rounded-full overflow-hidden mt-1.5 flex">
                                <div
                                  className="bg-indigo-500 h-full rounded-full"
                                  style={{ width: `${(inv.availableUnits / (inv.totalUnits || 1)) * 100}%` }}
                                />
                                <div
                                  className="bg-amber-500 h-full"
                                  style={{ width: `${(inv.reservedUnits / (inv.totalUnits || 1)) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="pt-5 border-t border-border mt-5 flex gap-2">
                      <button
                        onClick={() => openReserveModal(product)}
                        disabled={isOutOfStock}
                        className="flex-1 flex justify-center items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/10 hover:shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Plus className="w-4 h-4" /> Reserve Hold
                      </button>

                      {/* Concurrency Simulator Button */}
                      <button
                        onClick={() => handleTriggerConcurrencyTest(
                          product.id,
                          product.stockBreakdown.find(w => w.availableUnits > 0)?.warehouseId || product.stockBreakdown[0]?.warehouseId,
                          product.totalAvailable
                        )}
                        disabled={isOutOfStock || isSimulating}
                        className="flex items-center justify-center p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-all disabled:opacity-50"
                        title="Simulate Concurrency Race"
                      >
                        <Zap className="w-4.5 h-4.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Concurrency Simulation Logs Panel */}
          {battleLogs.length > 0 && (
            <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-rose-500">
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                  <h3 className="font-extrabold text-md uppercase tracking-wider">Concurrency Battle Arena Logs</h3>
                </div>
                <button
                  onClick={() => setBattleLogs([])}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Clear Logs
                </button>
              </div>

              <div className="bg-slate-950 text-slate-100 rounded-xl p-4 font-mono text-xs overflow-hidden border border-slate-900 max-h-[300px] overflow-y-auto space-y-2">
                {battleLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-start gap-1 p-2 rounded border transition-all ${
                      log.status === 'success'
                        ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50'
                        : log.status === 'conflict'
                        ? 'bg-rose-950/40 text-rose-400 border-rose-900/50'
                        : 'bg-indigo-950/30 text-indigo-400 border-indigo-950'
                    }`}
                  >
                    <span className="text-[10px] opacity-50 shrink-0 select-none mr-2">[{log.timestamp}]</span>
                    <span className="font-bold shrink-0 min-w-[150px]">{log.user}:</span>
                    <span className="flex-1 leading-relaxed">{log.message}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-current shrink-0">
                      HTTP {log.code || '...'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-normal max-w-xl">
                &gt; Note: When concurrent checkout holds are fired overlapping, PostgreSQL row lock <code className="font-mono bg-muted px-1 rounded text-red-500">FOR UPDATE</code> serializes the operations inside active transactions. The victorious transaction successfully holds the item, while subsequent ones immediately trigger a safe, atomic <code className="font-mono bg-muted px-1 rounded text-red-500">409 Conflict</code> rejection, completely protecting stock.
              </p>
            </div>
          )}
        </div>

        {/* Right Side: Active Holds & Sim Checkout Panel (1 col) */}
        <div className="space-y-8">
          <div className="bg-card border border-border p-6 rounded-2xl shadow-sm space-y-5 flex flex-col h-full justify-between">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg">Active Checkout holds</h3>
                  <p className="text-xs text-muted-foreground">List of current inventory reservations and states</p>
                </div>
                <span className="font-mono text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold px-2 py-0.5 rounded-full">
                  {reservationsData?.reservations.length || 0} Total
                </span>
              </div>

              {/* Holds Queue List */}
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                {!reservationsData || reservationsData.reservations.length === 0 ? (
                  <div className="text-center py-12 space-y-2 border border-dashed border-border rounded-xl">
                    <Timer className="w-8 h-8 text-muted-foreground/60 mx-auto" />
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto px-4">
                      No stock reservation holds found. Click "Reserve Hold" on any catalog item to launch checkout payment.
                    </p>
                  </div>
                ) : (
                  reservationsData.reservations.map((hold) => {
                    const isPending = hold.status === 'PENDING';
                    
                    return (
                      <div
                        key={hold.id}
                        className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                          hold.status === 'CONFIRMED'
                            ? 'bg-emerald-50/10 border-emerald-200 dark:border-emerald-950/20'
                            : hold.status === 'EXPIRED'
                            ? 'bg-rose-50/10 border-rose-200 dark:border-rose-950/10 opacity-70'
                            : hold.status === 'RELEASED'
                            ? 'bg-slate-50/10 border-slate-200 dark:border-slate-800/80 opacity-70'
                            : 'bg-card border-indigo-200 dark:border-indigo-950/80 ring-1 ring-indigo-500/20'
                        }`}
                      >
                        <div className="space-y-2.5">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <h5 className="font-bold text-xs leading-tight">{hold.product.name}</h5>
                              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 font-medium">
                                <Warehouse className="w-3 h-3 text-indigo-400" />
                                {hold.warehouse.name} ({hold.warehouse.location})
                              </p>
                            </div>
                            <span className={`text-[9px] uppercase tracking-wide font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                              hold.status === 'CONFIRMED'
                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                : hold.status === 'EXPIRED'
                                ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300'
                                : hold.status === 'RELEASED'
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 animate-pulse'
                            }`}>
                              {hold.status}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-xs pt-1 border-t border-border">
                            <span className="text-muted-foreground font-medium">Reserved Hold:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                              {hold.quantity} Unit{hold.quantity > 1 ? 's' : ''}
                            </span>
                          </div>

                          {hold.idempotencyKey && (
                            <div className="text-[9px] font-mono text-muted-foreground flex items-center gap-1 bg-slate-50 dark:bg-slate-900 p-1.5 rounded border border-border">
                              <Lock className="w-2.5 h-2.5 text-indigo-400" />
                              <span>Key: {hold.idempotencyKey.substring(0, 18)}...</span>
                            </div>
                          )}

                          {/* Countdown Timer component for Pending holds */}
                          <CountdownTimer
                            expiresAt={hold.expiresAt}
                            createdAt={hold.createdAt}
                            status={hold.status}
                            onExpire={() => {
                              addToast('warning', 'Hold Expired', `Hold for ${hold.product.name} has run out and restored stock.`);
                              mutate('/api/products');
                              mutate('/api/reservations');
                            }}
                          />

                          {/* Timestamps for finished reservations */}
                          {!isPending && (
                            <div className="text-[10px] text-muted-foreground space-y-0.5 pt-1.5 border-t border-border">
                              {hold.status === 'CONFIRMED' && (
                                <p className="flex justify-between">
                                  <span>Deducted at:</span>
                                  <span className="font-mono">{new Date(hold.confirmedAt!).toLocaleTimeString()}</span>
                                </p>
                              )}
                              {hold.status === 'RELEASED' && (
                                <p className="flex justify-between">
                                  <span>Released at:</span>
                                  <span className="font-mono">{new Date(hold.releasedAt!).toLocaleTimeString()}</span>
                                </p>
                              )}
                              {hold.status === 'EXPIRED' && (
                                <p className="flex justify-between">
                                  <span>Expired at:</span>
                                  <span className="font-mono">{new Date(hold.releasedAt || hold.expiresAt).toLocaleTimeString()}</span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Interactive Hold Controls */}
                        {isPending && (
                          <div className="flex gap-2 pt-3.5 border-t border-border mt-3.5">
                            <button
                              onClick={() => handleConfirmReservation(hold.id)}
                              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/10 hover:shadow-emerald-500/20 transition-all"
                            >
                              <DollarSign className="w-3.5 h-3.5" /> Pay Now
                            </button>
                            <button
                              onClick={() => handleReleaseReservation(hold.id)}
                              className="flex items-center justify-center p-1.5 text-[11px] font-bold rounded-lg border border-border hover:bg-muted text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                              title="Cancel / Release Cart Hold"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-border text-[10px] text-muted-foreground flex justify-between">
              <span>Auto-polling system holds...</span>
              <span className="font-mono">Interval 3s</span>
            </div>
          </div>
        </div>
      </main>

      {/* Reservation Dialog Modal Backdrop */}
      {isCreateModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in zoom-in-95 duration-200 space-y-4">
            
            <div className="space-y-1">
              <h3 className="font-bold text-lg leading-tight">Secure Temporary Hold</h3>
              <p className="text-xs text-muted-foreground">Select fulfillment warehouse and set booking volume</p>
            </div>

            <form onSubmit={handleCreateReservation} className="space-y-4 pt-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Product</label>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-border rounded-xl text-xs space-y-1">
                  <h5 className="font-bold text-slate-800 dark:text-slate-200">{selectedProduct.name}</h5>
                  <p className="font-mono text-[9px] text-muted-foreground">{selectedProduct.sku}</p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Fulfillment Warehouse</label>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-border bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                >
                  {selectedProduct.stockBreakdown.map((inv) => (
                    <option
                      key={inv.warehouseId}
                      value={inv.warehouseId}
                      disabled={inv.availableUnits <= 0}
                    >
                      {inv.warehouseName} ({inv.availableUnits} Available)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    max={selectedProduct.stockBreakdown.find(w => w.warehouseId === selectedWarehouseId)?.availableUnits || 10}
                    value={reserveQuantity}
                    onChange={(e) => setReserveQuantity(parseInt(e.target.value) || 1)}
                    className="w-full p-2.5 rounded-xl border border-border bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-center"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Idempotency Key</label>
                  <input
                    type="text"
                    value={customIdempotencyKey}
                    onChange={(e) => setCustomIdempotencyKey(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-border bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-center"
                    placeholder="None"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 px-4 py-2 text-xs font-semibold rounded-xl border border-border hover:bg-muted text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 text-xs font-bold rounded-xl bg-indigo-650 hover:bg-indigo-600 text-white shadow-md shadow-indigo-650/10 hover:shadow-indigo-600/20 transition-all flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? 'Acquiring Lock...' : 'Book Hold'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
