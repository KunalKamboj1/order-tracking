import { useState, useEffect } from 'react'
import Head from 'next/head'
import Layout from '../components/Layout'
import axios from 'axios'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

export default function Reports({ setIsAuthenticated }) {
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateRange, setDateRange] = useState('30')
  const [reportType, setReportType] = useState('overview')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetchReportData()
  }, [dateRange, reportType])

  const fetchReportData = async () => {
    try {
      setLoading(true)
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://order-tracking-pro.onrender.com'
      const response = await axios.get(`${backendUrl}/api/admin/reports?type=${reportType}&days=${dateRange}`)
      setReportData(response.data || {})
    } catch (err) {
      console.error('Error fetching report data:', err)
      setError('Failed to load report data')
      
      // Set empty data when API fails
      setReportData({
        summary: {
          totalShops: 'N/A',
          activeShops: 'N/A',
          totalRevenue: 'N/A',
          totalTrackingRequests: 'N/A',
          averageRequestsPerShop: 'N/A',
          topPerformingShop: 'N/A'
        },
        growth: {
          shopsGrowth: 'N/A',
          revenueGrowth: 'N/A',
          trackingGrowth: 'N/A'
        },
        trends: [],
        topShops: [],
        carrierStats: [],
        planDistribution: []
      })
    } finally {
      setLoading(false)
    }
  }

  const exportReport = async (format) => {
    setExporting(true)
    try {
      // Simulate export process
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Create downloadable content
      const reportContent = generateReportContent(format)
      const blob = new Blob([reportContent], { 
        type: format === 'csv' ? 'text/csv' : 'application/json' 
      })
      
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `tracking-report-${format}-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const generateReportContent = (format) => {
    if (!reportData) return ''
    
    if (format === 'csv') {
      let csv = 'Report Type,Value\n'
      csv += `Total Shops,${reportData.summary.totalShops}\n`
      csv += `Active Shops,${reportData.summary.activeShops}\n`
      csv += `Total Revenue,$${reportData.summary.totalRevenue}\n`
      csv += `Total Tracking Requests,${reportData.summary.totalTrackingRequests}\n`
      csv += '\nTop Shops:\n'
      csv += 'Shop Domain,Revenue,Requests,Plan\n'
      reportData.topShops.forEach(shop => {
        csv += `${shop.shop},${shop.revenue},${shop.requests},${shop.plan}\n`
      })
      return csv
    } else {
      return JSON.stringify(reportData, null, 2)
    }
  }

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
        <title>Reports - Order Tracking Admin</title>
      </Head>
      
      <Layout setIsAuthenticated={setIsAuthenticated}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Analytics Reports</h1>
              <p className="text-gray-600">Comprehensive business intelligence and insights</p>
            </div>
            <div className="flex gap-2">
              <select
                className="input-field w-auto"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <option value="overview">Overview Report</option>
                <option value="revenue">Revenue Report</option>
                <option value="tracking">Tracking Report</option>
                <option value="shops">Shops Report</option>
              </select>
              <select
                className="input-field w-auto"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
              {error} - Showing demo data
            </div>
          )}

          {/* Export Actions */}
          <div className="card">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Export Reports</h3>
                <p className="text-sm text-gray-600">Download comprehensive reports in various formats</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => exportReport('csv')}
                  disabled={exporting}
                  className="btn-secondary"
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
                <button
                  onClick={() => exportReport('json')}
                  disabled={exporting}
                  className="btn-primary"
                >
                  {exporting ? 'Exporting...' : 'Export JSON'}
                </button>
              </div>
            </div>
          </div>

          {reportData && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Total Shops</p>
                      <p className="text-2xl font-semibold text-gray-900">{reportData.summary.totalShops}</p>
                    </div>
                    <div className="text-sm text-green-600 font-medium">
                      +{reportData.growth.shopsGrowth}%
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Total Revenue</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {typeof reportData.summary.totalRevenue === 'number' 
                          ? `$${reportData.summary.totalRevenue.toLocaleString()}` 
                          : reportData.summary.totalRevenue}
                      </p>
                    </div>
                    <div className="text-sm text-green-600 font-medium">
                      {typeof reportData.growth.revenueGrowth === 'number' 
                        ? `+${reportData.growth.revenueGrowth}%` 
                        : reportData.growth.revenueGrowth}
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Tracking Requests</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {typeof reportData.summary.totalTrackingRequests === 'number' 
                          ? reportData.summary.totalTrackingRequests.toLocaleString() 
                          : reportData.summary.totalTrackingRequests}
                      </p>
                    </div>
                    <div className="text-sm text-green-600 font-medium">
                      {typeof reportData.growth.trackingGrowth === 'number' 
                        ? `+${reportData.growth.trackingGrowth}%` 
                        : reportData.growth.trackingGrowth}
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Avg Requests/Shop</p>
                    <p className="text-2xl font-semibold text-gray-900">{reportData.summary.averageRequestsPerShop}</p>
                  </div>
                </div>
              </div>

              {/* Trend Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend</h3>
                  {reportData.trends && reportData.trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={reportData.trends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickFormatter={(date) => format(new Date(date), 'MMM dd')} />
                        <YAxis />
                        <Tooltip labelFormatter={(date) => format(new Date(date), 'MMM dd, yyyy')} />
                        <Legend />
                        <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} name="Revenue ($)" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-500">
                      No trend data available
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Shop Growth</h3>
                  {reportData.trends && reportData.trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={reportData.trends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickFormatter={(date) => format(new Date(date), 'MMM dd')} />
                        <YAxis />
                        <Tooltip labelFormatter={(date) => format(new Date(date), 'MMM dd, yyyy')} />
                        <Legend />
                        <Bar dataKey="newSignups" fill="#3B82F6" name="New Signups" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-500">
                      No growth data available
                    </div>
                  )}
                </div>
              </div>

              {/* Top Performers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Performing Shops</h3>
                  <div className="space-y-3">
                    {reportData.topShops && reportData.topShops.length > 0 ? (
                      reportData.topShops.map((shop, index) => (
                        <div key={shop.shop} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium mr-3">
                              {index + 1}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{shop.shop}</p>
                              <p className="text-xs text-gray-500">{shop.requests} requests</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900">${shop.revenue}</p>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              shop.plan === 'premium' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {shop.plan}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center py-8 text-gray-500">
                        No shop performance data available
                      </div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Plan Distribution</h3>
                  {reportData.planDistribution && reportData.planDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={reportData.planDistribution}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value, percentage }) => `${name}: ${value} (${(percentage * 100).toFixed(0)}%)`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {reportData.planDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-500">
                      No plan distribution data available
                    </div>
                  )}
                </div>
              </div>

              {/* Carrier Performance */}
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Carrier Performance Analysis</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Carrier
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Requests
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Market Share
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Avg Response Time
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Performance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportData.carrierStats && reportData.carrierStats.length > 0 ? (
                        reportData.carrierStats.map((carrier) => (
                          <tr key={carrier.name} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {carrier.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {typeof carrier.requests === 'number' ? carrier.requests.toLocaleString() : carrier.requests}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {typeof carrier.percentage === 'number' ? `${carrier.percentage}%` : carrier.percentage}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {typeof carrier.avgResponseTime === 'number' ? `${carrier.avgResponseTime}s` : carrier.avgResponseTime}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {typeof carrier.avgResponseTime === 'number' ? (
                                <div className="flex items-center">
                                  <div className="w-full bg-gray-200 rounded-full h-2 mr-2">
                                    <div 
                                      className="bg-green-600 h-2 rounded-full" 
                                      style={{ width: `${Math.min(100, (2.5 - carrier.avgResponseTime) * 40)}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    {carrier.avgResponseTime < 1.5 ? 'Excellent' : carrier.avgResponseTime < 2 ? 'Good' : 'Average'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-500">N/A</span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                            No carrier performance data available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </Layout>
    </>
  )
}