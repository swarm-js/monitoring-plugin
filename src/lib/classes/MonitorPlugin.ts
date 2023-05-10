import { MonitorPluginOptions } from '../interfaces/MonitorPluginOptions'
import { SwarmMonitorData } from '../interfaces/SwarmMonitorData'

let monitorData: Map<string, SwarmMonitorData> = new Map<
  string,
  SwarmMonitorData
>()
let startDate: number
let swarm: any
let conf: MonitorPluginOptions

export default class MonitorPlugin {
  static setup (instance: any, options: Partial<MonitorPluginOptions> = {}) {
    swarm = instance
    startDate = +new Date()

    conf = {
      controllerName: 'MonitoringPlugin',
      prefix: '/__monitoring__',
      access: null,
      ...options
    }

    instance.hooks.add('preHandler', (state: any) => {
      state.startDate = +new Date()
      return state
    })
    instance.hooks.add('postHandler', (state: any) => {
      state.endDate = +new Date()
      MonitorPlugin.saveData(
        state.controller,
        state.method,
        state.endDate - state.startDate
      )
    })
    instance.controllers.addController(conf.controllerName, {
      prefix: conf.prefix,
      title: 'Monitoring',
      description:
        'Provides analytics on this API usage, like volume, durations, etc',
      root: true
    })
    instance.controllers.addMethod(
      conf.controllerName,
      MonitorPlugin.getStats,
      {
        method: 'GET',
        route: '/stats/:filter',
        title: 'Retrieve analytics',
        parameters: [
          {
            name: 'filter',
            schema: { type: 'string' },
            description:
              'Method name as in controller@method. Use "all" to retrieve global statistics.'
          }
        ],
        returns: [
          {
            code: 200,
            description: 'Analytics',
            mimeType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                uptime: {
                  type: 'number',
                  description: 'Number of milliseconds since last reboot'
                },
                global: {
                  type: 'object',
                  properties: {
                    calls: { type: 'number' },
                    duration: {
                      type: 'object',
                      properties: {
                        avg: { type: 'number' },
                        min: { type: 'number' },
                        max: { type: 'number' }
                      }
                    }
                  }
                },
                perDay: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      calls: { type: 'number' },
                      duration: {
                        type: 'object',
                        properties: {
                          avg: { type: 'number' },
                          min: { type: 'number' },
                          max: { type: 'number' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        ]
      }
    )
  }

  static getData () {
    return monitorData.values()
  }

  static saveData (controller: any, method: any, duration: number) {
    let data: SwarmMonitorData | undefined = monitorData.get(
      `${controller.name}@${method.name}`
    )
    if (data === undefined)
      data = {
        controllerName: controller.name,
        methodName: method.name,
        method: method.method,
        path: method.fullRoute,
        calls: 0,
        totalDuration: 0,
        minDuration: null,
        maxDuration: null,
        perDay: {}
      }
    data.calls++
    data.totalDuration += duration
    if (data.minDuration === null || data.minDuration > duration)
      data.minDuration = duration
    if (data.maxDuration === null || data.maxDuration < duration)
      data.maxDuration = duration

    const today = new Date().toISOString().split('T')[0]
    if (data.perDay[today] === undefined)
      data.perDay[today] = {
        calls: 0,
        totalDuration: 0,
        minDuration: null,
        maxDuration: null
      }
    data.perDay[today].calls++
    data.perDay[today].totalDuration += duration
    if (data.minDuration === null || data.perDay[today].minDuration > duration)
      data.perDay[today].minDuration = duration
    if (
      data.perDay[today].maxDuration === null ||
      data.perDay[today].maxDuration < duration
    )
      data.perDay[today].maxDuration = duration
    monitorData.set(`${controller.name}@${method.name}`, data)
  }

  static async getStats (request: any) {
    swarm.checkAccess(request, conf.access)

    const days: number = +(request.query.days ?? 30)
    let date = new Date()
    date.setDate(date.getDate() - days)
    const minDate: string = date.toISOString().split('T')[0]

    let ret: any = {
      uptime: +new Date() - (startDate ?? +new Date()),
      global: {
        calls: 0,
        duration: {
          avg: 0,
          min: null,
          max: null
        }
      },
      perDay: {}
    }

    for (const item of MonitorPlugin.getData()) {
      if (
        request.params.filter !== 'all' &&
        request.params.filter !== `${item.controllerName}@${item.methodName}`
      )
        continue

      ret.global.calls += item.calls
      ret.global.duration.avg += item.totalDuration
      if (
        item.minDuration !== null &&
        (ret.global.duration.min === null ||
          item.minDuration < ret.global.duration.min)
      )
        ret.global.duration.min = item.minDuration
      if (
        item.maxDuration !== null &&
        (ret.global.duration.max === null ||
          item.maxDuration > ret.global.duration.max)
      )
        ret.global.duration.max = item.maxDuration

      for (let day of Object.keys(item.perDay)) {
        if (day < minDate) continue

        if (ret.perDay[day] === undefined)
          ret.perDay[day] = {
            calls: 0,
            duration: {
              avg: 0,
              min: null,
              max: null
            }
          }

        ret.perDay[day].calls += item.calls
        ret.perDay[day].duration.avg += item.totalDuration
        if (
          item.minDuration !== null &&
          (ret.perDay[day].duration.min === null ||
            item.minDuration < ret.perDay[day].duration.min)
        )
          ret.perDay[day].duration.min = item.minDuration
        if (
          item.maxDuration !== null &&
          (ret.perDay[day].duration.max === null ||
            item.maxDuration > ret.perDay[day].duration.max)
        )
          ret.perDay[day].duration.max = item.maxDuration
      }
    }

    ret.global.duration.avg /= ret.global.calls
    for (let day in ret.perDay) {
      ret.perDay[day].duration.avg /= ret.perDay[day].calls
    }

    return ret
  }
}
