import Link from "next/link";

export default function Kitchen() {
  return (
    <div className="min-h-screen bg-bg p-8 text-white">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-2xl font-bold tracking-wide bg-gradient-to-r from-primary via-purple-300 to-white bg-clip-text text-transparent">Aetheris AI <span className="text-text-muted font-normal">| Kitchen Hub</span></Link>
        </div>
        <div className="flex gap-8 text-sm font-medium">
          <span className="text-text-muted cursor-pointer hover:text-white">Live Stream</span>
          <span className="text-text-muted cursor-pointer hover:text-white">Inventory</span>
          <span className="text-white cursor-pointer">Kitchen Hub</span>
          <span className="text-text-muted cursor-pointer hover:text-white">Analytics</span>
        </div>
      </div>

      <div className="flex gap-4 mb-8">
        <div className="bg-surface p-4 rounded-2xl flex items-center gap-4 min-w-[200px]">
          <div className="w-12 h-12 rounded-full bg-primary bg-opacity-20 flex items-center justify-center">🍽️</div>
          <div>
            <p className="text-xs text-text-muted">Active Orders</p>
            <p className="text-2xl font-bold">24</p>
          </div>
        </div>
        <div className="bg-surface p-4 rounded-2xl flex items-center gap-4 min-w-[200px]">
          <div className="w-12 h-12 rounded-full bg-primary bg-opacity-20 flex items-center justify-center">⏱️</div>
          <div>
            <p className="text-xs text-text-muted">Avg. Prep Time</p>
            <p className="text-2xl font-bold">12:40</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Incoming Orders */}
        <div className="bg-surface bg-opacity-50 rounded-2xl p-4 border border-surface min-h-[60vh]">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary"></span>
            Incoming Orders <span className="bg-surface px-2 py-1 rounded text-xs ml-auto">08</span>
          </h3>
          <div className="bg-surface p-4 rounded-xl border border-primary border-opacity-30">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-bold">#1204</span>
              <span className="bg-primary text-xs px-2 py-0.5 rounded-full">HIGH PRIORITY</span>
            </div>
            <p className="font-medium mb-4">Sarah M.</p>
            <div className="space-y-2 text-sm text-text-muted">
              <div className="flex justify-between"><span>2x Burger Royale</span> <span className="text-white">M</span></div>
              <div className="flex justify-between"><span>1x Truffle Fries</span> <span className="text-white">-</span></div>
            </div>
          </div>
        </div>
        {/* Preparing */}
        <div className="bg-surface bg-opacity-50 rounded-2xl p-4 border border-surface min-h-[60vh]">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            Preparing <span className="bg-surface px-2 py-1 rounded text-xs ml-auto">05</span>
          </h3>
        </div>
        {/* Ready to Serve */}
        <div className="bg-surface bg-opacity-50 rounded-2xl p-4 border border-surface min-h-[60vh]">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            Ready to Serve <span className="bg-surface px-2 py-1 rounded text-xs ml-auto">03</span>
          </h3>
        </div>
        {/* Completed */}
        <div className="bg-surface bg-opacity-50 rounded-2xl p-4 border border-surface min-h-[60vh]">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-500"></span>
            Completed <span className="bg-surface px-2 py-1 rounded text-xs ml-auto">142</span>
          </h3>
        </div>
      </div>
    </div>
  );
}
