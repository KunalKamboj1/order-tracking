import { useState, useEffect } from 'react'
import Head from 'next/head'
import Layout from '../components/Layout'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'
import axios from 'axios'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']

export default function Dashboard({ setIsAuthenticated }) {
  const [stats, setStats] = useState({
    totalShops: 0,
    activeSubscriptions: 0,
    totalTracking: 0,
    revenue: 0
  })
  const [chartData, setChartData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
        const response = await fetch(`${backendUrl}/api/admin/dashboard`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data');
        }
        
        const data = await response.json();
        setStats({
          totalShops: data.totalShops || 0,
          activeSubscriptions: data.activeSubscriptions || 0,
          totalTracking: data.totalTracking || 0,
          revenue: data.revenue || 0
        });
        setChartData(data.chartData || []);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        setError('Failed to load dashboard data');
        // Fallback to existing fetchDashboardData function
        await fetchDashboardData();
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const backendUrl = process.env.BACKEND_URL
      
      // Fetch dashboard statistics
      const [shopsRes, billingRes] = await Promise.all([
        axios.get(`${backendUrl}/api/admin/shops`),
        axios.get(`${backendUrl}/api/admin/billing`)
      ])

      // Calculate stats from API responses
      const shops = shopsRes.data || []
      const billing = billingRes.data || []
      
      setStats({
        totalShops: shops.length,
        activeSubscriptions: billing.filter(b => b.status === 'active').length,
        totalTracking: shops.reduce((sum, shop) => sum + (shop.tracking_count || 0), 0),
        revenue: billing.reduce((sum, b) => sum + (parseFloat(b.amount) || 0), 0)
      })

      // Generate chart data for the last 7 days
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date()
        date.setDate(date.getDate() - (6 - i))
        return {
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          shops: Math.floor(Math.random() * 10) + shops.length - 5,
          tracking: Math.floor(Math.random() * 50) + 20,
          revenue: Math.floor(Math.random() * 200) + 100
        }
      })
      
      setChartData(last7Days)
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
      setError('Failed to load dashboard data')
      // Set mock data for demo purposes
      setStats({
        totalShops: 45,
        activeSubscriptions: 38,
        totalTracking: 1247,
        revenue: 2850
      })
      
      const mockData = Array.from({ length: 7 }, (_, i) => {
        const date = new Date()
        date.setDate(date.getDate() - (6 - i))
        return {
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          shops: Math.floor(Math.random() * 10) + 40,
          tracking: Math.floor(Math.random() * 50) + 150,
          revenue: Math.floor(Math.random() * 200) + 200
        }
      })
      setChartData(mockData)
    } finally {
      setLoading(false)
    }
  }

  const StatCard = ({ title, value, icon, color = 'primary' }) => (
    <div className="card">
      <div className="flex items-center">
        <div className={`flex-shrink-0 p-3 rounded-lg bg-${color}-100`}>
          <span className="text-2xl">{icon}</span>
        </div>
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <Layout setIsAuthenticated={setIsAuthenticated}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    )
  }

  return (
    <>
      <Head>
        <title>Dashboard - Order Tracking Admin</title>
      </Head>
      
      <Layout setIsAuthenticated={setIsAuthenticated}>
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard Overview</h1>
            <p className="text-gray-600">Welcome to your order tracking analytics dashboard</p>
          </div>

          {error && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
              {error} - Showing demo data
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Total Shops"
              value={stats.totalShops.toLocaleString()}
              icon="🏪"
              color="blue"
            />
            <StatCard
              title="Active Subscriptions"
              value={stats.activeSubscriptions.toLocaleString()}
              icon="💳"
              color="green"
            />
            <StatCard
              title="Total Tracking Requests"
              value={stats.totalTracking.toLocaleString()}
              icon="📦"
              color="yellow"
            />
            <StatCard
              title="Monthly Revenue"
              value={`$${stats.revenue.toLocaleString()}`}
              icon="💰"
              color="purple"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Line Chart */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Tracking Requests (Last 7 Days)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="tracking" stroke="#3B82F6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Bar Chart */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend (Last 7 Days)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
            <div className="space-y-3">
              {[
                { action: 'New shop registered', shop: 'example-store.myshopify.com', time: '2 minutes ago', type: 'success' },
                { action: 'Subscription upgraded', shop: 'fashion-boutique.myshopify.com', time: '15 minutes ago', type: 'info' },
                { action: 'Tracking request processed', shop: 'tech-gadgets.myshopify.com', time: '1 hour ago', type: 'default' },
                { action: 'Payment received', shop: 'home-decor.myshopify.com', time: '2 hours ago', type: 'success' },
                { action: 'Widget installed', shop: 'sports-gear.myshopify.com', time: '3 hours ago', type: 'info' }
              ].map((activity, index) => (
                <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                  <div className="flex items-center">
                    <div className={`w-2 h-2 rounded-full mr-3 ${
                      activity.type === 'success' ? 'bg-green-400' :
                      activity.type === 'info' ? 'bg-blue-400' : 'bg-gray-400'
                    }`}></div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{activity.action}</p>
                      <p className="text-xs text-gray-500">{activity.shop}</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">{activity.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Layout>
    </>
  )
}