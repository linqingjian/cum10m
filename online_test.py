import time
import os
import sys
from loguru import logger
import subprocess
import argparse
import re
import datetime
import random

file_sep = str('\u0001')
scm_sep = str('\u0006')

#re_params = re.compile('(nvl\(params\[\'@*[\u4E00-\u9FA5]*[\w]*\'\],params\[\'@*[\u4E00-\u9FA5]*[\w]*\'\]\))|(params\[\'@*[\u4E00-\u9FA5]*[\w]*\'\])',re.I)
#增加匹配 nvl(params['应用特效(6.0后)'],params['应用特效（6.0后）']) 参数
re_params = re.compile('(nvl\(\s*params\[\'@*[\u4E00-\u9FA5]*[\w]*(\(*（*\d*\.\d*[\u4E00-\u9FA5]*\)*）*)*\'\]\s*,\s*params\[\'@*[\u4E00-\u9FA5]*[\w]*(\(*（*\d*\.\d*[\u4E00-\u9FA5]*\)*）*)*\'\]\s*\))|(params\[\'@*[\u4E00-\u9FA5]*[\w]*(\(*（*\d*\.\d*[\u4E00-\u9FA5]*\)*）*)*\'\])',re.I)

# 自定义异常
class Tool_deal_Exception(Exception):
    def __init__(self, msg):
        self.msg = msg

    def __str__(self):
        return self.msg

def RemoveFiles(file_path):
    logger.info("删除文件" + file_path)
    if os.path.isdir(file_path):
        for root, dirs, files in os.walk(file_path):
            for name in files:
                os.remove(os.path.join(root, name))
                logger.info("==========Delete File: " + os.path.join(root, name))
    else:
        os.remove(file_path)
        logger.info("==========Delete File: " +file_path)



# 从配置表获取配置文件
def get_hive_tool_config_file(main_func_name):
    try:
        config_sql = """
SELECT  {0}
FROM {dim_config_tab}
WHERE record_type {dim_condition} '素材'
AND length(event_id) > '0'
and app_name = '美图秀秀'
and event_id>'0'
AND length(trim(level1)) > 1
{main_func_name}
{debug_event_id}
        """.format(','.join(column_list),**program_tab_mapping,main_func_name = main_func_name,debug_event_id = debug_event_id)
        # datawork-client方式提交
        exec_cmd = """datawork-client query_to_local -hql  "%s" -project_name mtxx  -ca_config_path /www/lqj/dataworks/ca_config.properties -env prod -se Presto -fd %s -file_path %s -hive_env huawei -v """ \
                   % (config_sql, str('\\0001') , config_file_path)
        logger.info(exec_cmd)
        subprocess.check_call(exec_cmd, shell=True)
    except Exception as e:
        logger.error("从hive表获取配置文件失败！")
        logger.error(str(e))
        sys.exit(-1)


# 获取事件配置
def get_tool_event_config():
    tool_event_list = []
    event_list = []
    try:
        with open(config_file_path, 'r') as f:
            line_cnt = 0
            for lines in f.readlines():
                line_cnt += 1
                config_map = {}
                config_content = lines.split(file_sep)

                # 获取每个字段配置
                for column_name in column_list:
                    try:
                        if column_name == 'material_id':
                            config_map[column_name] = config_content[column_list.index(column_name)].strip().strip('\t').strip('\n').replace('‘', "'").replace('’', "'")
                        else:
                            config_map[column_name] = config_content[column_list.index(column_name)].strip().strip('\t').strip('\n').replace('‘', "'").replace('’', "'").replace("（","(").replace("）",")")
                        #logger.info("校验列:{0} 对应值：{1}".format(column_name, config_map[column_name]))
                        # 直接从params字段取值字段判断 re.match('^params\[\'[\u4E00-\u9FA5]*\w*\'\]$', config_map[column_name])
                        if params_list.index(column_name) >= 0:
                            #logger.info(column_name + " 列值    " + config_map[column_name])
                            matchObj = re_params.match(config_map[column_name])
                            #logger.info(matchObj)
                            if matchObj:
                               pass
                            else:
                                # 当无params参数时置为空
                                config_map[column_name] = "无参数"

                    except ValueError as e:
                        #logger.info("判断列{0}配置符合规则错误，配置值为{1}".format(column_name,config_content[column_list.index(column_name)]))
                        config_map[column_name] = config_content[column_list.index(column_name)].strip().strip('\t').strip('\n').replace('‘', "'").replace('’', "'")


                # 特殊字段校验
                event_id = config_map['event_id']
                if len(config_map['level1']) == 0:  # 校验一级功能字段
                    logger.info(
                        "配置文件第 " + str(line_cnt) + "行记录 level1:" + config_map['level1'] + "，level2:" + config_map[
                            'level2'] + "，未获取到一级功能，跳过此功能计算！")
                elif len(event_id) > 0 and re.match(r'^[a-zA-Z]([a-zA-Z]+_)*[&a-zA-Z]+$', event_id) != None:  # 校验事件id
                    event_list.append("'" + event_id + "'")
                    tool_event_list.append(config_map)
                    # logger.info(config_map)
                else:
                    logger.info(
                        "配置文件第 " + str(line_cnt) + "行记录 level1:" + config_map['level1'] + "，level2:" + config_map[
                            'level2'] + "，未获取到包含英文字母和下划线的event_id：" + event_id + "，跳过此功能计算！")
                    logger.info(config_content)
                    # print(event_id,config_content)

        if len(event_list) == 0:
            raise Tool_deal_Exception("工具功能获取为空，程序退出！")
    except Tool_deal_Exception as e:
        logger.error(str(e))
        sys.exit(1)
    except Exception as e:
        logger.info("获取功能配置异常，异常退出！")
        logger.error(str(e))
        sys.exit(2)
    return tool_event_list, list(set(event_list))


# 拼接sql
def tool_event_deal_sql(tool_event_list, event_list,main_func_name,debug_flag):
    try:
        # print(event_list_str)
        # print(tool_event_list)

        # 单个事件调试模式限制条件：
        run_debug_flag = """ AND 1 = 1 """
        if debug_flag == '1':
            run_debug_flag = """ AND 1 = 0 """

        where_filter_sql = []
        scm_sql = []
        tab_id_sql = []
        posi_id_sql = []
        material_id_sql = []
        second_icon_sql = []
        camera_mode_sql = []
        sharephone_mode_sql = []

        tool_event_cnt = 0
        for event_conf in tool_event_list:
            if tool_event_cnt == 0:
                where_filter_sql.append("""sum(case """)
            tool_event_cnt = tool_event_cnt + 1
            # where/pv字段 条件逻辑处理
            where_filter_condition = event_conf[where_filter_column]
            common__condition = """WHEN a.event_id = '{event_id}' AND b.level1 = '{level1}' AND b.level2 = '{level2}' AND b.level3 = '{level3}' AND b.level4 = '{level4}' AND b.level5 = '{level5}' AND b.record_type = '{record_type}' AND b.
media_type = '{media_type}' AND b.event_type = '{event_type}' """.format(
                **event_conf)
            if len(where_filter_condition) > 0 and where_filter_condition.find('params') != -1:  # 有配置where条件且条件中有params
                where_filter_sql.append(
                    """{common__condition} AND ( {0} ) then a.cnt \n """.format(where_filter_condition,
                                                                                common__condition=common__condition))
                # SCM 字段判断处理
                if event_conf['scm'] != "无参数":
                    scm_sql.append("""{common__condition} AND ( {0} ) then {1} \n """.format(where_filter_condition,
                                                                                             event_conf['scm'],
                                                                                             common__condition=common__condition))
                # tba_id 字段判断处理
                if event_conf['tab_id'] != "无参数":
                    tab_id_sql.append("""{common__condition} AND ( {0} ) then {1} \n """.format(where_filter_condition,
                                                                                                event_conf['tab_id'],
                                                                                                common__condition=common__condition))
                # 位置 字段判断处理
                if event_conf['posi_id'] != "无参数":
                    posi_id_sql.append("""{common__condition} AND ( {0} ) then {1} \n """.format(where_filter_condition,
                                                                                                 event_conf['posi_id'],
                                                                                                 common__condition=common__condition))
                # 素材id 字段判断处理
                if event_conf['material_id'] != "无参数":
                    material_id_sql.append(
                        """{common__condition} AND ( {0} ) then {1} \n """.format(where_filter_condition,
                                                                                  event_conf['material_id'],
                                                                                  common__condition=common__condition))



            elif len(where_filter_condition) > 0 and where_filter_condition.find(
                    'params') == -1:  # 有配置where条件且条件中无params
                logger.info("event_id: {event_id} ，where_filter_condition: {0} 有值但未找到params参数，直接使用事件统计，未做参数过滤！".format(
                    where_filter_condition, **event_conf))
                where_filter_sql.append(
                    """{common__condition} then a.cnt \n """.format(common__condition=common__condition))
                if event_conf['scm'] != "无参数":
                    scm_sql.append("""{common__condition} then {0} \n """.format(event_conf['scm'],
                                                                                 common__condition=common__condition))
                if event_conf['tab_id'] != "无参数":
                    tab_id_sql.append("""{common__condition} then {0} \n """.format(event_conf['tab_id'],
                                                                                    common__condition=common__condition))
                if event_conf['posi_id'] != "无参数":
                    posi_id_sql.append("""{common__condition} then {0} \n """.format(event_conf['posi_id'],
                                                                                     common__condition=common__condition))
                if event_conf['material_id'] != "无参数":
                    material_id_sql.append("""{common__condition} then {0} \n """.format(event_conf['material_id'],
                                                                                         common__condition=common__condition))

            else:  # 未配置where条件直接使用事件统计
                where_filter_sql.append(
                    """{common__condition} then a.cnt \n """.format(common__condition=common__condition))
                if event_conf['scm'] != "无参数":
                    scm_sql.append("""{common__condition} then {0} \n """.format(event_conf['scm'],
                                                                                 common__condition=common__condition))
                if event_conf['tab_id'] != "无参数":
                    tab_id_sql.append("""{common__condition} then {0} \n """.format(event_conf['tab_id'],
                                                                                    common__condition=common__condition))
                if event_conf['posi_id'] != "无参数":
                    posi_id_sql.append("""{common__condition} then {0} \n """.format(event_conf['posi_id'],
                                                                                     common__condition=common__condition))
                if event_conf['material_id'] != "无参数":
                    material_id_sql.append("""{common__condition} then {0} \n """.format(event_conf['material_id'],
                                                                                         common__condition=common__condition))

            if tool_event_cnt == len(tool_event_list):
                where_filter_sql.append(""" ELSE 0 END) """)

            # 垂类 字段判断处理
            if event_conf['second_icon'] in ['是', '否']:
                second_icon_sql.append(
                    """WHEN b.second_icon in ('是','否') THEN '{0}' \n """.format(event_conf['second_icon']))
            else:
                if re_params.match(event_conf['second_icon']) or len(event_conf['second_icon']) > 2:
                    second_icon_sql.append("""WHEN date_p >= 20221009 AND {0} THEN '是' \n """.format(event_conf['second_icon']))

            #相机经典、生图模式判断处理 camera_mode
            if event_conf['camera_mode'] in ['经典', '生图']:
                camera_mode_sql.append("""{common__condition} THEN '{camera_mode}' \n """.format(common__condition = common__condition,camera_mode = event_conf['camera_mode']))
            elif re_params.match(event_conf['camera_mode']) or len(event_conf['camera_mode']) > 2:
                camera_mode_sql.append("""{common__condition} THEN {camera_mode} \n """.format(common__condition = common__condition,camera_mode = event_conf['camera_mode']))
            else:
                pass

            # 共享修图 sharephone_mode
            if re_params.match(event_conf['sharephone']) or len(event_conf['sharephone']) > 2:
                sharephone_mode_sql.append("""{common__condition} AND {sharephone} THEN '是' \n """.format(common__condition = common__condition,sharephone = event_conf['sharephone']))
            else:
                pass

        # 拼接SCM case when 结束标志
        if len(scm_sql) > 0:
            scm_sql.insert(0, 'CASE ')
            scm_sql.append(' ELSE null END')
        elif len(scm_sql) == 0:
            scm_sql.append('null')
        else:
            pass

        # 拼接TAB_ID case when 结束标志
        if len(tab_id_sql) > 0:
            tab_id_sql.insert(0, 'CASE ')
            tab_id_sql.append(' ELSE null END')
        elif len(tab_id_sql) == 0:
            tab_id_sql.append('null')
        else:
            pass

        # 拼接位置 case when 结束标志
        if len(posi_id_sql) > 0:
            posi_id_sql.insert(0, 'CASE ')
            posi_id_sql.append(' ELSE null END')
        elif len(posi_id_sql) == 0:
            posi_id_sql.append('null')
        else:
            pass

        # 拼接素材 case when 结束标志
        if len(material_id_sql) > 0:
            material_id_sql.insert(0, 'CASE ')
            material_id_sql.append(' ELSE null END')
        elif len(material_id_sql) == 0:
            material_id_sql.append('null')
        else:
            pass

        # 垂类字段去重
        second_icon_sql = list(set(second_icon_sql))

        # 相机经典、生图模式 case 开始结束标识 camera_mode
        if len(camera_mode_sql) > 0:
            camera_mode_sql.insert(0, 'CASE ')
            camera_mode_sql.append(' ELSE null END')
        elif len(camera_mode_sql) == 0:
            camera_mode_sql.append('null')
        else:
            pass

        # 共享修图 sharephone_mode
        if len(sharephone_mode_sql) > 0:
            sharephone_mode_sql.insert(0, 'CASE ')
            sharephone_mode_sql.append(" ELSE '否' END")
        elif len(sharephone_mode_sql) == 0:
            sharephone_mode_sql.append(" '否' ")
        else:
            pass

        #logger.info("where_filter_sql -- > \n" + " ".join(where_filter_sql))
        #logger.info("scm_sql -- > \n" + " ".join(scm_sql))
        #logger.info("tab_id_sql -- > \n" + " ".join(tab_id_sql))
        #logger.info("posi_id_sql -- > \n" + " ".join(posi_id_sql))
        #logger.info("material_id_sql -- > \n" + " ".join(material_id_sql))
        #logger.info("second_icon_sql -- > \n" + " ".join(second_icon_sql))

        deal_sql_mapping = {}
        deal_sql_mapping['where_filter_sql'] = " ".join(where_filter_sql).replace("（","(").replace("）",")")
        if len(scm_sql) == 1 and scm_sql[0] == "null":
            deal_sql_mapping['scm_sql'] = " ".join(scm_sql)
        else:
            deal_sql_mapping['scm_sql'] = """split(replace(""" + " ".join(scm_sql) + """, '\$\$\$','{scm_sep}'),'{scm_sep}')[0]""".format(scm_sep=scm_sep)
        deal_sql_mapping['tab_id_sql'] = " ".join(tab_id_sql)
        deal_sql_mapping['posi_id_sql'] = " ".join(posi_id_sql)
        deal_sql_mapping['material_id_sql'] = " ".join(material_id_sql)
        deal_sql_mapping['second_icon_sql'] = "CASE " + " ".join(second_icon_sql) + "WHEN date_p = {0} THEN '否' \n ELSE '否' END\n".format(date_p)
        deal_sql_mapping['camera_mode_sql'] = " ".join(camera_mode_sql)
        deal_sql_mapping['sharephone_mode_sql'] = " ".join(sharephone_mode_sql)



        deal_sql_mapping['column_list_info'] = ",".join(column_list)
        result_event_list = []
        result_event_list = event_list
        result_event_list.append("'mhmr_homesave'")
        deal_sql_mapping['event_id_info'] = ",".join(result_event_list)
        #logger.info(deal_sql_mapping)

        tmp_deal_sql = """
    SELECT /*+MAPJOIN(b)*/
            a.gid                                            AS gid
           ,a.uid                                            AS uid
           ,a.app_version                                    AS app_version
           ,a.country_id                                     AS country_id
           ,a.os_type                                        AS os_type
           ,null                                             AS is_new_user
           ,a.event_id                                       AS event_id
           ,if(length(b.level1)  = 0,null,b.level1)           AS main_func_name
           ,if(length(b.level2)  = 0,null,b.level2)           AS sub_func_level2_name
           ,if(length(b.level3)  = 0,null,b.level3)           AS sub_func_level3_name
           ,if(length(b.level4)  = 0,null,b.level4)           AS sub_func_level4_name
           ,if(length(b.level5)  = 0,null,b.level5)           AS sub_func_level5_name
           ,if(length(b.record_type)  = 0,null,b.record_type) AS record_type
           ,if(length(b.media_type)  = 0,null,b.media_type)   AS media_type
           ,{sharephone_mode_sql}                            AS sharephone
           ,{second_icon_sql}                                AS second_icon
           ,if(length(b.deal_mode)  = 0,null,b.deal_mode)     AS deal_mode
           ,if(length(b.event_type)  = 0,null,b.event_type)   AS event_type
           ,{scm_sql}                                        AS scm
           ,{tab_id_sql}                                     AS tab_id
           ,{posi_id_sql}                                    AS posi_id
           ,{material_id_sql}                                AS material_id
           ,{camera_mode_sql}                                AS camera_mode
           ,a.ab_codes                                       AS ab_codes
           ,a.trace_id                                       AS trace_id
           ,{where_filter_sql}                               AS cnt
           ,a.area                                           AS area
           ,if(length(b.level1) = 0,0,1) + if(length(b.level2) = 0,0,1) + if(length(b.level3) = 0,0,1) + if(length(b.level4) = 0,0,1) + if(length(b.level5) = 0,0,1) as tool_level
           ,if(length(b.vip_func_id) > 0,b.vip_func_id,null) AS vip_func_id
           ,a.ori_unique_record                              AS ori_unique_record
           ,a.material_scm
           ,a.template_material_id
           ,receive_time
           ,b.material_id  as params_key
           ,a.date_p                                         AS date_p
           ,CASE WHEN b.level1 = '相机' THEN 'camera'
                 WHEN b.level1 in ('图片美化','美化') THEN 'mh'
                 WHEN b.level1 in ('人像美容','美容') THEN 'mr'
                 WHEN b.level1 = '视频剪辑' THEN 'spmh'
                 WHEN b.level1 = '视频美容' THEN 'spmr'
                 WHEN b.level1 = '首页垂类' THEN 'homeicon'
                 WHEN b.level1 = '拼图' THEN 'pt' END         AS model_p
    FROM
    (

         SELECT  a.gid
                ,a.uid
                ,a.app_version
                ,a.country_id
                ,a.os_type
                ,a.event_id
                ,a.params
                ,a.cnt
                ,a.date_p
                ,a.app_key_p
                ,a.trace_id
                ,a.ab_codes
                ,a.area
                ,a.ori_unique_record
                ,a.material_scm
                ,a.template_material_id
                ,receive_time
        from
          (
             
           SELECT  a.server_id                                                                                                                               AS gid
                    ,a.uid
                    ,a.app_version
                    ,a.country_id
                    ,a.os_type
                    ,params['material_scm']  as material_scm
                    ,params ['同款素材'] as template_material_id
                    ,CASE WHEN a.event_id = 'mhmr_homesave' AND params['source_type'] in ('mr','sharephoto')  THEN 'mr_homesave'
                             WHEN a.event_id = 'mhmr_homesave' AND params['source_type'] in ('mh','batch')  THEN 'mh_homesave'
                             when from_unixtime(int(receive_time / 1000), "yyyyMMdd")<'20250509' and event_id='blend_tab_click' then 'blend_tab_click_'  ELSE event_id END              AS event_id
                    ,a.params
                    ,1                                                                                                                                         AS cnt
                    ,a.date_p
                    ,receive_time
                    ,a.app_key_p
                    ,mt_traceinfo_getkey_index(trace_info,'00006','trace_id') ['trace_id']                                                                     AS trace_id
                    ,mt_ab_able_codes(ab_info)                                                                                                                 AS ab_codes
                    ,if(country_id = 10184 or country_id is null ,'China','Overseas')                                                                          AS area
                    ,MD5(concat_ws('#',session_id,event_id,log_id,cast(time as string),cast(send_time AS string),cast(receive_time AS string),gid,mt_map_to_json_v2(params)))                                      AS ori_unique_record
             FROM stat_sdk.sdk_odz_source_data a
             WHERE a.date_p = {date_p}
             AND a.app_key_p IN ('C4FAF9CE1569F541', 'F5C7F68C7117630B')
             AND a.event_id IN ({event_id_info}) 
             {run_debug_flag}
        ) a
        WHERE a.event_id not in ('tool_material_show','tool_material_click','tool_material_yes') OR ({event_filter_condition})
    ) a
    INNER JOIN
    (
         SELECT  {column_list_info}
         FROM {dim_config_tab}
         WHERE record_type {dim_condition} '素材'
         and app_name = '美图秀秀'
         AND length(event_id) > '0'        
         AND length(trim(level1)) > 1
         {main_func_name}
    ) b
    ON a.event_id = b.event_id
    GROUP BY  a.gid
             ,a.uid
             ,a.app_version
             ,a.country_id
             ,a.os_type
             ,a.event_id
             ,if(length(b.level1)  = 0,null,b.level1)
             ,if(length(b.level2)  = 0,null,b.level2)
             ,if(length(b.level3)  = 0,null,b.level3)
             ,if(length(b.level4)  = 0,null,b.level4)
             ,if(length(b.level5)  = 0,null,b.level5)
             ,if(length(b.record_type)  = 0,null,b.record_type)
             ,if(length(b.media_type)  = 0,null,b.media_type)
             ,{sharephone_mode_sql}
             ,{second_icon_sql}
             ,if(length(b.deal_mode)  = 0,null,b.deal_mode)
             ,if(length(b.event_type)  = 0,null,b.event_type)
             ,{scm_sql}
             ,{tab_id_sql}
             ,{posi_id_sql}
             ,{material_id_sql}
             ,{camera_mode_sql}
             ,a.ab_codes
             ,a.trace_id
             ,receive_time
             ,a.area
             ,if(length(b.level1) = 0,0,1) + if(length(b.level2) = 0,0,1) + if(length(b.level3) = 0,0,1) + if(length(b.level4) = 0,0,1) + if(length(b.level5) = 0,0,1)
             ,if(length(b.vip_func_id) > 0,b.vip_func_id,null)
             ,a.ori_unique_record
             ,a.material_scm
             ,a.template_material_id
             ,b.material_id  
             ,a.date_p
             ,CASE WHEN b.level1 = '相机' THEN 'camera'
                   WHEN b.level1 in ('图片美化','美化') THEN 'mh'
                   WHEN b.level1 in ('人像美容','美容') THEN 'mr'
                   WHEN b.level1 = '视频剪辑' THEN 'spmh'
                   WHEN b.level1 = '视频美容' THEN 'spmr'
                   WHEN b.level1 = '首页垂类' THEN 'homeicon'
                   WHEN b.level1 = '拼图' THEN 'pt' END
            """.format(date_p = date_p, **deal_sql_mapping, scm_sep=scm_sep,**program_tab_mapping,main_func_name = main_func_name,run_debug_flag = run_debug_flag,event_filter_condition = event_filter_condition)
        logger.info(tmp_deal_sql)

        if tab_name == "tool":
            deal_sql = """
            set hive.exec.dynamic.partition.mode=nonstrict;
            set spark.sql.shuffle.partitions=300;
            set spark.yarn.driver.memoryOverhead=4g;
            set spark.driver.memory=8g;
            set spark.yarn.queue=root.mtxx.date;
            set mapred.max.split.size=134217728;
            set mapred.min.split.size=67108864;
            set spark.sql.broadcastTimeout=1200;
            insert overwrite table {tool} partition(date_p,model_p)
            SELECT /*+MAPJOIN(b)*/ result.gid
                   ,uid
                   ,app_version
                   ,country_id
                   ,os_type
                   ,if(c.gid is not null,1,0)                        AS is_new_user
                   ,event_id
                   ,main_func_name
                   ,sub_func_level2_name
                   ,sub_func_level3_name
                   ,sub_func_level4_name
                   ,sub_func_level5_name
                   ,record_type
                   ,media_type
                   ,sharephone
                   ,second_icon
                   ,deal_mode
                   ,event_type
                   ,camera_mode
                   ,scm
                   ,tab_id
                   ,posi_id
                   ,vip_func_id
                   ,ab_codes
                   ,trace_id
                   ,tool_level
                   ,cnt
                   ,ori_unique_record
                   ,receive_time
                   ,date_p
                   ,model_p
            FROM
            (
                {tmp_deal_sql}
            ) result
            LEFT JOIN
            (
                 SELECT  a.server_id AS gid
                 FROM stat_sdk.sdk_odz_new_server_info a
                 WHERE a.date_p = {date_p}
                 AND a.app_key_p IN ('C4FAF9CE1569F541', 'F5C7F68C7117630B')
                 GROUP BY  a.server_id
            ) c
            ON result.gid = c.gid
            WHERE result.cnt > 0
                        """.format(date_p = date_p,tmp_deal_sql=tmp_deal_sql,**program_tab_mapping)
            logger.info(deal_sql)
        elif tab_name == "material":
            deal_sql = """
set hive.exec.dynamic.partition.mode=nonstrict;
set spark.sql.shuffle.partitions=600;
set spark.yarn.driver.memoryOverhead=4g;
set spark.driver.memory=8g;
set spark.yarn.queue=root.mtxx.date;
set mapred.max.split.size=134217728;
set mapred.min.split.size=67108864;
set spark.sql.broadcastTimeout=1200;
INSERT OVERWRITE TABLE {material} partition(date_p, model_p)
SELECT  /*+MAPJOIN(b,material)*/ a.gid
       ,a.uid
       ,a.app_version
       ,a.country_id
       ,a.os_type
       ,if(c.gid is not null,1,0)                        AS is_new_user
       ,a.event_id
       ,a.main_func_name
       ,a.sub_func_level2_name
       ,a.sub_func_level3_name
       ,a.sub_func_level4_name
       ,a.sub_func_level5_name
       ,a.record_type
       ,a.media_type
       ,a.sharephone
       ,a.second_icon
       ,a.deal_mode
       ,a.event_type
       ,a.camera_mode
       ,a.scm
       ,a.tab_id
       ,a.posi_id
       ,a.material_id_new
       ,a.ab_codes
       ,a.trace_id
       ,a.tool_level
       ,SUM(a.cnt)                                      AS cnt
       ,if(material.material_id is not null,1,0)               AS is_vip_material
       ,a.ori_unique_record
       ,a.material_scm
       ,a.template_material_id
       ,a.params_key
       ,a.date_p
       ,a.model_p
FROM
(
    SELECT  gid
           ,uid
           ,app_version
           ,country_id
           ,os_type
           ,is_new_user
           ,event_id
           ,main_func_name
           ,sub_func_level2_name
           ,sub_func_level3_name
           ,sub_func_level4_name
           ,sub_func_level5_name
           ,record_type
           ,media_type
           ,sharephone
           ,second_icon
           ,deal_mode
           ,event_type
           ,camera_mode
           ,scm
           ,tab_id
           ,posi_id
           ,material_id_new
           ,cast(split(regexp_replace(material_id_new,'&','\.'),'\\\\.')[0] as bigint) as material_id_concat
           ,ab_codes
           ,trace_id
           ,tool_level
           ,area
           ,cnt
           ,ori_unique_record
           ,material_scm
           ,template_material_id
           ,params_key
           ,date_p
           ,model_p
    FROM
    ( {tmp_deal_sql}
    ) result lateral view explode(split(regexp_replace(replace(material_id, '\\073', ','), '\\\\\[|\\\\\]', ''), ',')) tab AS material_id_new
    WHERE result.cnt > 0
    AND material_id_new is not null 
) a
LEFT JOIN
(
        SELECT  material_id
        FROM stat_meitu.mtxx_oda_tool_material_info_view
        WHERE date_p = {date_p}
        AND is_vip_flag = 1
        AND platform IN (1, 2)
        GROUP BY  material_id
) material
ON a.material_id_concat = material.material_id
LEFT JOIN
(
     SELECT  a.server_id AS gid
     FROM stat_sdk.sdk_odz_new_server_info a
     WHERE a.date_p = {date_p}
     AND a.app_key_p IN ('C4FAF9CE1569F541', 'F5C7F68C7117630B')
     GROUP BY  a.server_id
) c
ON a.gid = c.gid
where cast(a.material_id_concat as bigint) > 0
GROUP BY  a.gid
         ,a.uid
         ,a.app_version
         ,a.country_id
         ,a.os_type
         ,if(c.gid is not null,1,0)
         ,a.event_id
         ,a.main_func_name
         ,a.sub_func_level2_name
         ,a.sub_func_level3_name
         ,a.sub_func_level4_name
         ,a.sub_func_level5_name
         ,a.record_type
         ,a.media_type
         ,a.sharephone
         ,a.second_icon
         ,a.deal_mode
         ,a.event_type
         ,a.camera_mode
         ,a.scm
         ,a.tab_id
         ,a.posi_id
         ,a.material_id_new
         ,a.ab_codes
         ,a.trace_id
         ,a.tool_level
         ,if(material.material_id is not null,1,0)
         ,a.ori_unique_record
         ,a.material_scm
         ,a.template_material_id
         ,params_key
         ,a.date_p
         ,a.model_p
                        """.format(date_p=date_p, tmp_deal_sql=tmp_deal_sql,**program_tab_mapping)
            logger.info(deal_sql)
        else:
            logger.info("未获取到执行sql,tab_name args = {0},结果表 = ，退出".format(tab_name,program_tab_mapping[tab_name]))
            sys.exit(10)

        with open(execl_sql_file_path,'w') as f:
            f.write(deal_sql)

        logger.info("执行处理sql")
        exec_hql(deal_sql)


    except Exception as e:
        logger.error(str(e))
        logger.info("拼接执行sql失败！")
        sys.exit(3)


def exec_hql(deal_sql):
    # datawork-client方式提交
    #exec_cmd = """datawork-client execute -hql  "%s" -project_name userprofile  -ca_config_path /www/lqj/dataworks/ca_config.properties -env prod -se %s  -hive_env huawei -v """ % (deal_sql,exec_engine)
    exec_cmd = """datawork-client execute -f  "%s" -project_name mtxx  -ca_config_path /www/lqj/dataworks/ca_config.properties -env prod -se %s  -hive_env huawei -v """ % (execl_sql_file_path,exec_engine)
    logger.info(exec_cmd)
    subprocess.check_call(exec_cmd, shell=True)
    #RemoveFiles(execl_sql_file_path)

def man(main_func_name,debug_flag):
    tool_event_list, event_list = get_tool_event_config()
    if debug_flag == '0':
        tool_event_deal_sql(tool_event_list, event_list,main_func_name,debug_flag)
    else:
        logger.info("debug_flag = 1,开始单个事件调试模式")
        tmp_tool_event_list = []
        for event_id in tool_event_list:
            tmp_tool_event_list.append(event_id)
            tool_event_deal_sql(tmp_tool_event_list, event_list, main_func_name,debug_flag)




if __name__ == '__main__':
    # 配置传入参数
    current_date = (datetime.datetime.now() - datetime.timedelta(days=1)).strftime('%Y%m%d')
    current_time = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    last_date = (datetime.datetime.now() - datetime.timedelta(days=2)).strftime('%Y%m%d')
    model_dict = {'camera':'相机','mh':'美化','mr':'美容','pt':'拼图','spmh':'视频剪辑','homeicon':'首页垂类','spmr':'视频美容','all':'all'}
    exec_engine_dict = {'0':'SparkSql','1':'Hive','2':'Presto'}
    parser = argparse.ArgumentParser('传入参数：***.py')
    parser.add_argument('-d', '--date_p', required=True, default=current_date, help="数据日期")
    parser.add_argument('-t', '--tab_name', default='tool', choices=['tool', 'material', 'tab'],help="模块类型(功能：tool,素材：material,tab页：tab)")
    parser.add_argument('-e', '--tab_env', required=True, default="test", help="结果表类型(prod:正式表，test：测试表)", choices=['prod', 'test'])
    parser.add_argument('-m', '--model', default="pt", help="一级权益(camera:相机，mh：美化，mr:美容，pt:拼图，spmh:视频剪辑，spmr:视频美容,homeicon:首页垂类)", choices=['camera', 'mh', 'mr', 'pt', 'spmh', 'spmr','all','homeicon'])
    parser.add_argument('-y', '--debug_event', help="调试事件")
    parser.add_argument('-x', '--debug', default="0", help="是否逐行调试(1:是 0 否)", choices=['1', '0'])
    parser.add_argument('-s', '--exec_engine', default="0", help="执行引擎(1:Hive 0 SparkSql 2 Presto )", choices=['1', '0','2'])
    # parser.add_argument('-l','--level_type')
    args = parser.parse_args()
    date_p = args.date_p
    tab_name = args.tab_name
    tab_env = args.tab_env
    model = args.model
    debug_flag = args.debug
    debug_event = args.debug_event
    exec_engine = exec_engine_dict[args.exec_engine]
    # level_type = args.level_type

    log_path = "/data1/warehouse/logs/mt_tool_use/"
    # log_path = "/Users/wukui/Desktop/tmpdata/"
    if not os.path.exists(log_path):
        os.mkdir(log_path)
    log_path_error = os.path.join(log_path, f'mt_tool_use_{tab_env}_{tab_name}_{model}_date_p_{date_p}_exec_date_{time.strftime("%Y%m%d")}.log'.format(tab_env=tab_env,tab_name=tab_name,model=model,date_p={date_p}))
    logger.add(log_path_error, rotation='00:00', retention="3 days", enqueue=True, compression='zip')


    # 表参数变量设置
    program_tab_mapping = {}
    # 维表数据过滤条件
    dim_condition = "!="
    if tab_name == "material":
        dim_condition = "="
    program_tab_mapping['dim_condition'] = dim_condition

    #结果表参数设置
    tab_result_tmp = ""
    if tab_env == "test":
        tab_result_tmp = "_test"
    program_tab_mapping['tool'] = 'stat_meitu.mtxx_mdz_tool_behavior_detail{0}'.format(tab_result_tmp)
    program_tab_mapping['material'] = 'stat_meitu.mtxx_mdz_material_behavior_detail{0}'.format(tab_result_tmp)
    program_tab_mapping['dim_config_tab'] = 'stat_xingyun.xingyun_ona_app_dict_config_all{0}'.format(tab_result_tmp)


    # 指标逻辑where条件限制字段
    where_filter_column = 'filter_condition'
    logger.info("指标逻辑where条件限制字段：" + where_filter_column)
    # 需要从params字段中获取值字段列表
    params_list = ['scm', 'tab_id', 'posi_id', 'material_id']
    logger.info("需要从params字段中获取值字段列表：" + ','.join(params_list))
    # 需要从配置维表获取字段列表
    column_list = ['material_id','level1', 'level2', 'level3', 'level4', 'level5', 'event_id', 'record_type', 'media_type', 'sharephone',
                   'second_icon', 'deal_mode', 'event_type','camera_mode','vip_func_id']

    # 固定列位置
    tmp_column_list = {}
    for index, value in enumerate(column_list):
        tmp_column_list[value] = index
    for index, value in enumerate(params_list):
        tmp_column_list[value] = index
    tmp_column_list[where_filter_column] = 1

    column_list = list(tmp_column_list.keys())

    logger.info("获取维表字段列表：" + ','.join(column_list))

    # config_file_path = "/Users/wukui/Desktop/tmpdata/功能配置.txt"
    config_file_path = "/www/warehouse/mt_tool_use/config/{dim_config_tab}_{model}_{tab_name}_{date_p}_{current_time}.txt".format(dim_config_tab=program_tab_mapping['dim_config_tab'],date_p=date_p, current_time=current_time,model=model,tab_name=tab_name)
    execl_sql_file_path = "/www/warehouse/mt_tool_use/config/{dim_config_tab}_{model}_{tab_name}_{date_p}_{current_time}.sql".format(dim_config_tab=program_tab_mapping['dim_config_tab'],date_p=date_p, current_time=current_time,model=model,tab_name=tab_name)

    if debug_flag == '1':
        logger.info("debug_flag = 1,测试结果表{tab}不写入数据,如想写入数据，参数-x 0".format(tab=program_tab_mapping[tab_name]))
    debug_event_id = ""
    if tab_env == 'test':
        if debug_event != None and len(debug_event) > 0:
            logger.info("当前执行测试模式，测试事件为：{debug_event}".format(debug_event=debug_event))
            debug_event_id = "AND event_id = '{debug_event}' ".format(debug_event=debug_event)

    main_func_name = ""
    if model != 'all':
        main_func_name = "AND level1 = '{level1}'".format(level1=model_dict[model])
    #source表event数据量大，增加过滤条件
    event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND 1 = 1 "
    if model == 'camera':
        event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND a.params['一级ID'] in ('04') "
    elif model == 'mh':
        event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND a.params['一级ID'] in ('01') "
    elif model == 'mr':
        event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND a.params['一级ID'] in ('02') "
    elif model == 'spmh':
        event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND a.params['一级ID'] in ('05') "
    elif model == 'spmr':
        event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND a.params['一级ID'] in ('05') "
    elif model == 'pt':
        event_filter_condition = "a.event_id in ('tool_material_show','tool_material_click','tool_material_yes') AND a.params['一级ID'] in ('03','01') "

    get_hive_tool_config_file(main_func_name)
    man(main_func_name,debug_flag)
    RemoveFiles(execl_sql_file_path)
    RemoveFiles(config_file_path)
