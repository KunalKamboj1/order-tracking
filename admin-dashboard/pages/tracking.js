import { useState, useEffect } from 'react'
import Head from 'next/head'
import Layout from '../components/Layout'
import axios from 'axios'
import { format } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, AreaChart, Area } from 'recharts'

export default function Tracking({ setIsAuthenticated }) {
  const [trackingData, setTrackingData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeRange, setTimeRange] = useState('7')
  const [stats, setStats] = useState({
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0
  })

  useEffect(() => {
    fetchTrackingData()
  }, [timeRange])

  const fetchTrackingData = async () => {
    try {
      setLoading(true)
      const backendUrl = process.env.BACKEND_URL
      const response = await axios.get(`${backendUrl}/api/admin/tracking?days=${timeRange}`)
      setTrackingData(response.data || [])
      
      // Calculate stats from API response
      const data = response.data || []
      const total = data.length
      const successful = data.filter(item => item.status === 'success').length
      const failed = total - successful
      
      setStats({
        totalRequests: total,
        successfulRequests: successful,
        failedRequests: failed,
        averageResponseTime: 1.2 // Mock response time
      })
    } catch (err) {
      console.error('Error fetching tracking data:', err)
      setError('Failed to load tracking data')
      
      // Mock data for demo
      setStats({
        totalRequests: 1247,
        successfulRequests: 1189,
        failedRequests: 58,
        averageResponseTime: 1.2
      })
    } finally {
      setLoading(false)
    }
  }

  // Generate chart data based on time range
  const generateChartData = () => {
    const days = parseInt(timeRange)
    return Array.from({ length: days }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - (days - 1 - i))
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        requests: Math.floor(Math.random() * 100) + 50,
        successful: Math.floor(Math.random() * 90) + 45,
        failed: Math.floor(Math.random() * 10) + 2,
        responseTime: (Math.random() * 2 + 0.5).toFixed(1)
      }
    })
  }

  const chartData = generateChartData()

  // Popular tracking carriers
  const carrierData = [
    { name: 'FedEx', requests: 342, percentage: 27.4 },
    { name: 'UPS', requests: 298, percentage: 23.9 },
    { name: 'USPS', requests: 256, percentage: 20.5 },
    { name: 'DHL', requests: 189, percentage: 15.2 },
    { name: 'Others', requests: 162, percentage: 13.0 }
  ]

  // Hourly distribution
  const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${hour}:00`,
    requests: Math.floor(Math.random() * 50) + 10
  }))

  const successRate = stats.totalRequests > 0 ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1) : 0

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
        <title>Tracking Analytics - Order Tracking Admin</title>
      </Head>
      
      <Layout setIsAuthenticated={setIsAuthenticated}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Tracking Analytics</h1>
              <p className="text-gray-600">Monitor order tracking requests and performance metrics</p>
            </div>
            <select
              className="input-field w-auto"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>

          {error && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
              {error} - Showing demo data
            </div>
          )}

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card">
              <div className="flex items-center">
                <div className="flex-shrink-0 p-3 rounded-lg bg-blue-100">
                  <span className="text-2xl">📦</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Total Requests</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.totalRequests.toLocaleString()}</p>
                </div>
              </div>
            </div>
            
            <div className="card">
              <div className="flex items-center">
                <div className="flex-shrink-0 p-3 rounded-lg bg-green-100">
                  <span className="text-2xl">✅</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Success Rate</p>
                  <p className="text-2xl font-semibold text-gray-900">{successRate}%</p>
                </div>
              </div>
            </div>
            
            <div className="card">
              <div className="flex items-center">
                <div className="flex-shrink-0 p-3 rounded-lg bg-red-100">
                  <span className="text-2xl">❌</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Failed Requests</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.failedRequests.toLocaleString()}</p>
                </div>
              </div>
            </div>
            
            <div className="card">
              <div className="flex items-center">
                <div className="flex-shrink-0 p-3 rounded-lg bg-yellow-100">
                  <span className="text-2xl">⚡</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Avg Response Time</p>
                  <p className="text-2xl font-semibold text-gray-900">{stats.averageResponseTime}s</p>
                </div>
              </div>
            </div>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Requests Over Time */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Tracking Requests Over Time</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="successful" stackId="1" stroke="#10B981" fill="#10B981" />
                  <Area type="monotone" dataKey="failed" stackId="1" stroke="#EF4444" fill="#EF4444" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Response Time */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Average Response Time</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(value) => [`${value}s`, 'Response Time']} />
                  <Legend />
                  <Line type="monotone" dataKey="responseTime" stroke="#F59E0B" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Carrier Distribution */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Popular Carriers</h3>
              <div className="space-y-3">
                {carrierData.map((carrier, index) => (
                  <div key={carrier.name} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className={`w-3 h-3 rounded-full mr-3`} style={{ backgroundColor: `hsl(${index * 60}, 70%, 50%)` }}></div>
                      <span className="text-sm font-medium text-gray-900">{carrier.name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-500">{carrier.requests} requests</span>
                      <span className="text-sm font-medium text-gray-900">{carrier.percentage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hourly Distribution */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Hourly Request Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={hourlyData.filter((_, i) => i % 2 === 0)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="requests" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Tracking Requests */}
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Recent Tracking Requests</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Order ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Shop
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Carrier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Response Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[
                    { orderId: '#1001', shop: 'example-store.myshopify.com', carrier: 'FedEx', status: 'success', responseTime: '1.2s', timestamp: new Date() },
                    { orderId: '#1002', shop: 'fashion-boutique.myshopify.com', carrier: 'UPS', status: 'success', responseTime: '0.8s', timestamp: new Date(Date.now() - 5 * 60 * 1000) },
                    { orderId: '#1003', shop: 'tech-gadgets.myshopify.com', carrier: 'USPS', status: 'failed', responseTime: '3.1s', timestamp: new Date(Date.now() - 10 * 60 * 1000) },
                    { orderId: '#1004', shop: 'home-decor.myshopify.com', carrier: 'DHL', status: 'success', responseTime: '1.5s', timestamp: new Date(Date.now() - 15 * 60 * 1000) },
                    { orderId: '#1005', shop: 'sports-gear.myshopify.com', carrier: 'FedEx', status: 'success', responseTime: '0.9s', timestamp: new Date(Date.now() - 20 * 60 * 1000) }
                  ].map((request, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {request.orderId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {request.shop}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {request.carrier}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          request.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {request.responseTime}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(request.timestamp, 'MMM dd, HH:mm:ss')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Layout>
    </>
  )
}