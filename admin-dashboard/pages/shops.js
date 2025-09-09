import { useState, useEffect } from 'react'
import Head from 'next/head'
import Layout from '../components/Layout'
import axios from 'axios'
import { format } from 'date-fns'

export default function Shops({ setIsAuthenticated }) {
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('desc')

  useEffect(() => {
    fetchShops()
  }, [])

  const fetchShops = async () => {
    try {
      setLoading(true)
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000'
      const response = await axios.get(`${backendUrl}/api/admin/shops`)
      setShops(response.data || [])
    } catch (err) {
      console.error('Error fetching shops:', err)
      setError('Failed to load shops data')
      // Mock data for demo
      setShops([
        {
          id: 1,
          shop_domain: 'example-store.myshopify.com',
          access_token: 'shpat_***',
          created_at: new Date().toISOString(),
          status: 'active',
          plan: 'premium',
          tracking_count: 145,
          last_activity: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 2,
          shop_domain: 'fashion-boutique.myshopify.com',
          access_token: 'shpat_***',
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          status: 'active',
          plan: 'free',
          tracking_count: 23,
          last_activity: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 3,
          shop_domain: 'tech-gadgets.myshopify.com',
          access_token: 'shpat_***',
          created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'inactive',
          plan: 'premium',
          tracking_count: 89,
          last_activity: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const filteredShops = shops.filter(shop =>
    shop.shop_domain.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const sortedShops = [...filteredShops].sort((a, b) => {
    let aValue = a[sortBy]
    let bValue = b[sortBy]
    
    if (sortBy === 'created_at' || sortBy === 'last_activity') {
      aValue = new Date(aValue)
      bValue = new Date(bValue)
    }
    
    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1
    } else {
      return aValue < bValue ? 1 : -1
    }
  })

  const getStatusBadge = (status) => {
    const baseClasses = 'px-2 py-1 text-xs font-medium rounded-full'
    if (status === 'active') {
      return `${baseClasses} bg-green-100 text-green-800`
    } else {
      return `${baseClasses} bg-red-100 text-red-800`
    }
  }

  const getPlanBadge = (plan) => {
    const baseClasses = 'px-2 py-1 text-xs font-medium rounded-full'
    if (plan === 'premium') {
      return `${baseClasses} bg-purple-100 text-purple-800`
    } else {
      return `${baseClasses} bg-gray-100 text-gray-800`
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
        <title>Shops Management - Order Tracking Admin</title>
      </Head>
      
      <Layout setIsAuthenticated={setIsAuthenticated}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Shops Management</h1>
              <p className="text-gray-600">Manage all registered Shopify stores</p>
            </div>
            <div className="text-sm text-gray-500">
              Total: {shops.length} shops
            </div>
          </div>

          {error && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
              {error} - Showing demo data
            </div>
          )}

          {/* Filters */}
          <div className="card">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search shops..."
                  className="input-field"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <select
                  className="input-field"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="created_at">Sort by Created Date</option>
                  <option value="shop_domain">Sort by Domain</option>
                  <option value="tracking_count">Sort by Tracking Count</option>
                  <option value="last_activity">Sort by Last Activity</option>
                </select>
                <select
                  className="input-field"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>
          </div>

          {/* Shops Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Shop Domain
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Plan
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tracking Count
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedShops.map((shop) => (
                    <tr key={shop.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900">
                            {shop.shop_domain}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={getStatusBadge(shop.status)}>
                          {shop.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={getPlanBadge(shop.plan)}>
                          {shop.plan}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {shop.tracking_count?.toLocaleString() || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(shop.created_at), 'MMM dd, yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {shop.last_activity ? format(new Date(shop.last_activity), 'MMM dd, HH:mm') : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {sortedShops.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">No shops found matching your search criteria.</p>
              </div>
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {shops.filter(s => s.status === 'active').length}
                </div>
                <div className="text-sm text-gray-500">Active Shops</div>
              </div>
            </div>
            <div className="card">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {shops.filter(s => s.plan === 'premium').length}
                </div>
                <div className="text-sm text-gray-500">Premium Plans</div>
              </div>
            </div>
            <div className="card">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {shops.reduce((sum, s) => sum + (s.tracking_count || 0), 0).toLocaleString()}
                </div>
                <div className="text-sm text-gray-500">Total Tracking Requests</div>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    </>
  )
}