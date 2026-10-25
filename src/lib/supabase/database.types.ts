
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_activity": {
                  Row: {
                    "client_id": string,"created_at": string,"deleted_at": string | null,"entity": string,"entity_id": string | null,"id": string,"summary": string,"tool": string,"undo": Json | null,"undone_at": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"entity": string,"entity_id"?: string | null,"id"?: string,"summary"?: string,"tool": string,"undo"?: Json | null,"undone_at"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"entity"?: string,"entity_id"?: string | null,"id"?: string,"summary"?: string,"tool"?: string,"undo"?: Json | null,"undone_at"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_clients": {
                  Row: {
                    "client_id": string,"created_at": string,"deleted_at": string | null,"id": string,"name": string,"revoked_at": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"revoked_at"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"revoked_at"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"areas": {
                  Row: {
                    "color": string,"created_at": string,"deleted_at": string | null,"id": string,"name": string,"seed_key": string | null,"sort": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name": string,"seed_key"?: string | null,"sort": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"seed_key"?: string | null,"sort"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"calendar_sources": {
                  Row: {
                    "color": string,"created_at": string,"deleted_at": string | null,"enabled": boolean,"google_calendar_id": string | null,"id": string,"kind": string,"name": string,"sort": string,"updated_at": string,"url": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"deleted_at"?: string | null,"enabled"?: boolean,"google_calendar_id"?: string | null,"id"?: string,"kind"?: string,"name": string,"sort": string,"updated_at"?: string,"url"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"deleted_at"?: string | null,"enabled"?: boolean,"google_calendar_id"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"sort"?: string,"updated_at"?: string,"url"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"event_links": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"event_all_day": boolean,"event_end": string,"event_id": string,"event_start": string,"event_title": string,"google_calendar_id": string,"id": string,"note_id": string | null,"recurring_event_id": string | null,"scope": string,"task_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"event_all_day"?: boolean,"event_end": string,"event_id": string,"event_start": string,"event_title"?: string,"google_calendar_id": string,"id"?: string,"note_id"?: string | null,"recurring_event_id"?: string | null,"scope"?: string,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"event_all_day"?: boolean,"event_end"?: string,"event_id"?: string,"event_start"?: string,"event_title"?: string,"google_calendar_id"?: string,"id"?: string,"note_id"?: string | null,"recurring_event_id"?: string | null,"scope"?: string,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_links_note_id_fkey"
      columns: ["note_id"]
isOneToOne: false
      referencedRelation: "notes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_links_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_links_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"google_accounts": {
                  Row: {
                    "connected_at": string,"created_at": string,"deleted_at": string | null,"email": string,"id": string,"refresh_token_enc": string | null,"scope": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connected_at"?: string,"created_at"?: string,"deleted_at"?: string | null,"email": string,"id"?: string,"refresh_token_enc"?: string | null,"scope"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "connected_at"?: string,"created_at"?: string,"deleted_at"?: string | null,"email"?: string,"id"?: string,"refresh_token_enc"?: string | null,"scope"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"links": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"source_block_id": string,"source_note_id": string,"target_note_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"source_block_id": string,"source_note_id": string,"target_note_id": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"source_block_id"?: string,"source_note_id"?: string,"target_note_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "links_source_block_id_fkey"
      columns: ["source_block_id"]
isOneToOne: false
      referencedRelation: "note_blocks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "links_source_note_id_fkey"
      columns: ["source_note_id"]
isOneToOne: false
      referencedRelation: "notes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "links_target_note_id_fkey"
      columns: ["target_note_id"]
isOneToOne: false
      referencedRelation: "notes"
      referencedColumns: ["id"]
    }
                  ]
                },"milestones": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"done_at": string | null,"due_date": string | null,"id": string,"project_id": string,"sort": string,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"done_at"?: string | null,"due_date"?: string | null,"id"?: string,"project_id": string,"sort": string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"done_at"?: string | null,"due_date"?: string | null,"id"?: string,"project_id"?: string,"sort"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestones_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestones_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "v_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"note_blocks": {
                  Row: {
                    "collapsed": boolean,"content": NonNullable<Json>,"content_text": string,"created_at": string,"deleted_at": string | null,"id": string,"note_id": string,"parent_id": string | null,"search": unknown,"sort": string,"task_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "collapsed"?: boolean,"content"?: NonNullable<Json>,"content_text"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"note_id": string,"parent_id"?: string | null,"search"?: never,"sort": string,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "collapsed"?: boolean,"content"?: NonNullable<Json>,"content_text"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"note_id"?: string,"parent_id"?: string | null,"search"?: never,"sort"?: string,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "note_blocks_note_id_fkey"
      columns: ["note_id"]
isOneToOne: false
      referencedRelation: "notes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "note_blocks_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "note_blocks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "note_blocks_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "note_blocks_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"note_shares": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"note_id": string,"revoked_at": string | null,"token": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"note_id": string,"revoked_at"?: string | null,"token": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"note_id"?: string,"revoked_at"?: string | null,"token"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "note_shares_note_id_fkey"
      columns: ["note_id"]
isOneToOne: false
      referencedRelation: "notes"
      referencedColumns: ["id"]
    }
                  ]
                },"note_types": {
                  Row: {
                    "counts_as_knowledge": boolean,"created_at": string,"deleted_at": string | null,"id": string,"key": string,"moved": Json | null,"name": string,"sort": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "counts_as_knowledge"?: boolean,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"key": string,"moved"?: Json | null,"name": string,"sort": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "counts_as_knowledge"?: boolean,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"key"?: string,"moved"?: Json | null,"name"?: string,"sort"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notes": {
                  Row: {
                    "archived_at": string | null,"area_id": string,"created_at": string,"deleted_at": string | null,"id": string,"project_id": string | null,"reviewed_at": string | null,"search": unknown,"tags": (string)[],"task_id": string | null,"title": string,"topic_id": string | null,"type": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"area_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"project_id"?: string | null,"reviewed_at"?: string | null,"search"?: never,"tags"?: (string)[],"task_id"?: string | null,"title"?: string,"topic_id"?: string | null,"type"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"area_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"project_id"?: string | null,"reviewed_at"?: string | null,"search"?: never,"tags"?: (string)[],"task_id"?: string | null,"title"?: string,"topic_id"?: string | null,"type"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notes_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notes_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notes_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "v_projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notes_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notes_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notes_topic_id_fkey"
      columns: ["topic_id"]
isOneToOne: false
      referencedRelation: "topics"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "area_id": string,"body": Json | null,"body_text": string,"closing_reflection": Json | null,"created_at": string,"deleted_at": string | null,"id": string,"last_activity_at": string,"links": NonNullable<Json>,"next_task_id": string | null,"outcome": NonNullable<Json>,"priority": number | null,"search": unknown,"sort": string,"start_date": string | null,"status": string,"target_date": string | null,"time_budget_weeks": number | null,"title": string,"updated_at": string,"user_id": string,"why": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id": string,"body"?: Json | null,"body_text"?: string,"closing_reflection"?: Json | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"last_activity_at"?: string,"links"?: NonNullable<Json>,"next_task_id"?: string | null,"outcome"?: NonNullable<Json>,"priority"?: number | null,"search"?: never,"sort": string,"start_date"?: string | null,"status"?: string,"target_date"?: string | null,"time_budget_weeks"?: number | null,"title"?: string,"updated_at"?: string,"user_id"?: string,"why"?: string
                  }
                  Update: {
                    "area_id"?: string,"body"?: Json | null,"body_text"?: string,"closing_reflection"?: Json | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"last_activity_at"?: string,"links"?: NonNullable<Json>,"next_task_id"?: string | null,"outcome"?: NonNullable<Json>,"priority"?: number | null,"search"?: never,"sort"?: string,"start_date"?: string | null,"status"?: string,"target_date"?: string | null,"time_budget_weeks"?: number | null,"title"?: string,"updated_at"?: string,"user_id"?: string,"why"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_next_task_fk"
      columns: ["next_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_next_task_fk"
      columns: ["next_task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"recaps": {
                  Row: {
                    "answers": NonNullable<Json>,"closed_at": string | null,"created_at": string,"deleted_at": string | null,"energy": number | null,"focus_next": NonNullable<Json>,"id": string,"kind": string,"learning": number | null,"mood": number | null,"period_end": string,"period_start": string,"questions": NonNullable<Json>,"relations": number | null,"review": NonNullable<Json>,"search": unknown,"sport": number | null,"stats": Json | null,"themes": (string)[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers"?: NonNullable<Json>,"closed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"energy"?: number | null,"focus_next"?: NonNullable<Json>,"id"?: string,"kind": string,"learning"?: number | null,"mood"?: number | null,"period_end": string,"period_start": string,"questions"?: NonNullable<Json>,"relations"?: number | null,"review"?: NonNullable<Json>,"search"?: never,"sport"?: number | null,"stats"?: Json | null,"themes"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"closed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"energy"?: number | null,"focus_next"?: NonNullable<Json>,"id"?: string,"kind"?: string,"learning"?: number | null,"mood"?: number | null,"period_end"?: string,"period_start"?: string,"questions"?: NonNullable<Json>,"relations"?: number | null,"review"?: NonNullable<Json>,"search"?: never,"sport"?: number | null,"stats"?: Json | null,"themes"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"saved_views": {
                  Row: {
                    "area_id": string | null,"config": NonNullable<Json>,"created_at": string,"deleted_at": string | null,"entity": string,"id": string,"name": string,"sort": string,"updated_at": string,"user_id": string,"view_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id"?: string | null,"config"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"entity": string,"id"?: string,"name": string,"sort": string,"updated_at"?: string,"user_id"?: string,"view_type": string
                  }
                  Update: {
                    "area_id"?: string | null,"config"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"entity"?: string,"id"?: string,"name"?: string,"sort"?: string,"updated_at"?: string,"user_id"?: string,"view_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_views_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    }
                  ]
                },"task_dependencies": {
                  Row: {
                    "blocked_by_task_id": string,"created_at": string,"deleted_at": string | null,"task_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_by_task_id": string,"created_at"?: string,"deleted_at"?: string | null,"task_id": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "blocked_by_task_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"task_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_dependencies_blocked_by_task_id_fkey"
      columns: ["blocked_by_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_dependencies_blocked_by_task_id_fkey"
      columns: ["blocked_by_task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_dependencies_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_dependencies_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_note_links": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"target_note_id": string,"task_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"target_note_id": string,"task_id": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"target_note_id"?: string,"task_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_note_links_target_note_id_fkey"
      columns: ["target_note_id"]
isOneToOne: false
      referencedRelation: "notes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_note_links_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_note_links_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "area_id": string | null,"assignee": string,"body": Json | null,"body_text": string,"completed_at": string | null,"created_at": string,"created_by": string,"deleted_at": string | null,"due_date": string | null,"duration_min": number | null,"edited_at": string | null,"focus_date": string | null,"id": string,"in_inbox": boolean,"milestone_id": string | null,"priority": number | null,"project_id": string | null,"recurrence": string | null,"recurrence_source_id": string | null,"scheduled_at": string | null,"search": unknown,"sort": string,"status": string,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id"?: string | null,"assignee"?: string,"body"?: Json | null,"body_text"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"duration_min"?: number | null,"edited_at"?: string | null,"focus_date"?: string | null,"id"?: string,"in_inbox"?: boolean,"milestone_id"?: string | null,"priority"?: number | null,"project_id"?: string | null,"recurrence"?: string | null,"recurrence_source_id"?: string | null,"scheduled_at"?: string | null,"search"?: never,"sort": string,"status"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "area_id"?: string | null,"assignee"?: string,"body"?: Json | null,"body_text"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"duration_min"?: number | null,"edited_at"?: string | null,"focus_date"?: string | null,"id"?: string,"in_inbox"?: boolean,"milestone_id"?: string | null,"priority"?: number | null,"project_id"?: string | null,"recurrence"?: string | null,"recurrence_source_id"?: string | null,"scheduled_at"?: string | null,"search"?: never,"sort"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_milestone_id_fkey"
      columns: ["milestone_id"]
isOneToOne: false
      referencedRelation: "milestones"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "v_projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_recurrence_source_id_fkey"
      columns: ["recurrence_source_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_recurrence_source_id_fkey"
      columns: ["recurrence_source_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"templates": {
                  Row: {
                    "body": NonNullable<Json>,"created_at": string,"deleted_at": string | null,"id": string,"kind": string,"name": string,"note_type": string | null,"seed_key": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind": string,"name": string,"note_type"?: string | null,"seed_key"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "body"?: NonNullable<Json>,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"note_type"?: string | null,"seed_key"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"topics": {
                  Row: {
                    "archived_at": string | null,"area_id": string,"created_at": string,"deleted_at": string | null,"id": string,"name": string,"sort": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"area_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name": string,"sort": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"area_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"sort"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "topics_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    }
                  ]
                },"user_settings": {
                  Row: {
                    "active_area_id": string | null,"created_at": string,"deleted_at": string | null,"evening_time": string,"id": string,"last_backup_at": string | null,"last_backup_summary": Json | null,"last_export_at": string | null,"theme": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_area_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"evening_time"?: string,"id"?: string,"last_backup_at"?: string | null,"last_backup_summary"?: Json | null,"last_export_at"?: string | null,"theme"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "active_area_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"evening_time"?: string,"id"?: string,"last_backup_at"?: string | null,"last_backup_summary"?: Json | null,"last_export_at"?: string | null,"theme"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_settings_active_area_id_fkey"
      columns: ["active_area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "v_projects": {
                  Row: {
                    "area_id": string | null,"closing_reflection": Json | null,"created_at": string | null,"deleted_at": string | null,"done_count": number | null,"id": string | null,"is_stale": boolean | null,"is_stuck": boolean | null,"last_activity_at": string | null,"next_task_id": string | null,"outcome": Json | null,"priority": number | null,"progress": number | null,"sort": string | null,"start_date": string | null,"status": string | null,"target_date": string | null,"task_count": number | null,"time_budget_weeks": number | null,"title": string | null,"updated_at": string | null,"user_id": string | null,"why": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "projects_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_next_task_fk"
      columns: ["next_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_next_task_fk"
      columns: ["next_task_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"v_tasks": {
                  Row: {
                    "area_id": string | null,"body": Json | null,"body_text": string | null,"completed_at": string | null,"created_at": string | null,"deleted_at": string | null,"due_date": string | null,"duration_min": number | null,"focus_date": string | null,"id": string | null,"in_inbox": boolean | null,"is_blocked": boolean | null,"milestone_id": string | null,"priority": number | null,"project_id": string | null,"recurrence": string | null,"recurrence_source_id": string | null,"scheduled_at": string | null,"sort": string | null,"status": string | null,"title": string | null,"updated_at": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "area_id"?: string | null,"body"?: Json | null,"body_text"?: string | null,"completed_at"?: string | null,"created_at"?: string | null,"deleted_at"?: string | null,"due_date"?: string | null,"duration_min"?: number | null,"focus_date"?: string | null,"id"?: string | null,"in_inbox"?: boolean | null,"is_blocked"?: never,"milestone_id"?: string | null,"priority"?: number | null,"project_id"?: string | null,"recurrence"?: string | null,"recurrence_source_id"?: string | null,"scheduled_at"?: string | null,"sort"?: string | null,"status"?: string | null,"title"?: string | null,"updated_at"?: string | null,"user_id"?: string | null
                         }
                        Update: {
                           "area_id"?: string | null,"body"?: Json | null,"body_text"?: string | null,"completed_at"?: string | null,"created_at"?: string | null,"deleted_at"?: string | null,"due_date"?: string | null,"duration_min"?: number | null,"focus_date"?: string | null,"id"?: string | null,"in_inbox"?: boolean | null,"is_blocked"?: never,"milestone_id"?: string | null,"priority"?: number | null,"project_id"?: string | null,"recurrence"?: string | null,"recurrence_source_id"?: string | null,"scheduled_at"?: string | null,"sort"?: string | null,"status"?: string | null,"title"?: string | null,"updated_at"?: string | null,"user_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "tasks_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_milestone_id_fkey"
      columns: ["milestone_id"]
isOneToOne: false
      referencedRelation: "milestones"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "v_projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_recurrence_source_id_fkey"
      columns: ["recurrence_source_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_recurrence_source_id_fkey"
      columns: ["recurrence_source_id"]
isOneToOne: false
      referencedRelation: "v_tasks"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "ai_client_allowed":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"close_recap":
{ Args: { "p_recap_id": string }; Returns: {
              "answers": NonNullable<Json>,
"closed_at": string | null,
"created_at": string,
"deleted_at": string | null,
"energy": number | null,
"focus_next": NonNullable<Json>,
"id": string,
"kind": string,
"learning": number | null,
"mood": number | null,
"period_end": string,
"period_start": string,
"questions": NonNullable<Json>,
"relations": number | null,
"review": NonNullable<Json>,
"search": unknown,
"sport": number | null,
"stats": Json | null,
"themes": (string)[],
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "recaps"
        isOneToOne: true
        isSetofReturn: false
      } },
"complete_task":
{ Args: { "p_next_due"?: string,"p_next_id"?: string,"p_task_id": string }; Returns: Json
                           },
"delete_note_type":
{ Args: { "p_key": string,"p_target": string }; Returns: undefined
                           },
"empty_trash":
{ Args: { "p_entity": string,"p_ids": (string)[] }; Returns: number
                           },
"note_share_active":
{ Args: { "p_note_id": string }; Returns: boolean
                           },
"restore_note_type":
{ Args: { "p_key": string,"p_note_ids": (string)[] }; Returns: undefined
                           },
"search_all":
{ Args: { "p_area_id"?: string,"p_query": string }; Returns: {
              "id": string,"kind": string,"rank": number,"snippet": string,"title": string
            }[]
                           },
"seed_user_defaults":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"shared_block_content":
{ Args: { "p_content": Json }; Returns: Json
                           },
"shared_note":
{ Args: { "p_token": string }; Returns: Json
                           },
"shared_note_file":
{ Args: { "p_path": string,"p_token": string }; Returns: string
                           },
"undo_complete_task":
{ Args: { "p_task_id": string }; Returns: Json
                           },
"week_stats":
{ Args: { "p_end": string,"p_start": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
