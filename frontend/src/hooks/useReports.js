// frontend/src/hooks/useReports.js
import { useState, useCallback, useEffect } from 'react';
import { reportsApi } from '../services/apiService';
import { getLocalDateString } from '../utils/dates';

const TODAY_STR = getLocalDateString();

export function useReports() {
  const [reportType, setReportType] = useState('daily');
  const [date, setDate]             = useState(TODAY_STR);
  const [startDate, setStartDate]   = useState(TODAY_STR);
  const [endDate, setEndDate]       = useState(TODAY_STR);
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      let res;
      switch (reportType) {
        case 'daily':
          res = await reportsApi.getDailySales(date);
          break;
        case 'range':
          res = await reportsApi.getRangeSales(startDate, endDate);
          break;
        case 'customers':
          res = await reportsApi.getCustomers(startDate, endDate);
          break;
        case 'vegetables':
          res = await reportsApi.getVegetables(startDate, endDate);
          break;
        case 'credit':
          res = await reportsApi.getCredit(date);
          break;
        case 'commission':
          res = await reportsApi.getCommission(startDate, endDate);
          break;
        case 'all_in_one':
          res = await reportsApi.getAllInOne(startDate, endDate);
          break;
        default:
          throw new Error('Invalid report type selected');
      }

      if (res && res.success) {
        setData(res.data);
      } else {
        setError(res?.error || 'Failed to retrieve report data');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while generating the report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [reportType, date, startDate, endDate]);

  // Automatically fetch when reportType changes or on mounting, and on sync event
  useEffect(() => {
    fetchReport();
    const onSynced = () => fetchReport();
    window.addEventListener('vyaparsetu:data-synced', onSynced);
    return () => window.removeEventListener('vyaparsetu:data-synced', onSynced);
  }, [reportType, fetchReport]);

  return {
    reportType,
    setReportType,
    date,
    setDate,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    data,
    loading,
    error,
    fetchReport
  };
}
